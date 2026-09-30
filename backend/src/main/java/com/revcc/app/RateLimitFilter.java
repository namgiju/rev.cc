package com.revcc.app;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/**
 * 인메모리 고정 윈도우(fixed window) rate limiter. core 인스턴스가 하나뿐인 현재 배포 구조를 전제로 하며,
 * 여러 인스턴스로 수평 확장하면 Redis 등 공유 저장소로 교체해야 한다.
 * nginx가 X-Forwarded-For를 자신이 본 주소 하나로 덮어쓰고 server.forward-headers-strategy=framework가
 * 이를 반영하므로 request.getRemoteAddr()는 프록시가 아닌 실제 클라이언트 IP를 가리킨다.
 * 만료된 윈도는 윈도 길이마다 한 번씩 정리해 클라이언트 수만큼 메모리가 계속 늘지 않게 한다.
 */
public class RateLimitFilter implements Filter {
    private record Window(long resetAt, AtomicLong count) {}
    private final Map<String, Window> hits = new ConcurrentHashMap<>();
    private final long windowMs;
    private final int max;
    private final LongSupplier clock;
    private final AtomicLong nextSweepAt;

    public RateLimitFilter(Duration window, int max) {
        this(window, max, System::currentTimeMillis);
    }

    RateLimitFilter(Duration window, int max, LongSupplier clock) {
        this.windowMs = window.toMillis();
        this.max = max;
        this.clock = clock;
        this.nextSweepAt = new AtomicLong(clock.getAsLong() + windowMs);
    }

    int bucketCount() { return hits.size(); }

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;
        String key = request.getRequestURI() + '|' + request.getRemoteAddr();
        long now = clock.getAsLong();
        long sweepAt = nextSweepAt.get();
        // 한 스레드만 정리한다. 값이 그대로일 때만 제거되므로 방금 새로 만든 윈도는 지워지지 않는다.
        if (now >= sweepAt && nextSweepAt.compareAndSet(sweepAt, now + windowMs))
            hits.values().removeIf(window -> now > window.resetAt());
        Window window = hits.compute(key, (k, existing) ->
            (existing == null || now > existing.resetAt()) ? new Window(now + windowMs, new AtomicLong(0)) : existing);
        if (window.count().incrementAndGet() > max) {
            response.setStatus(429);
            response.setHeader("Retry-After", String.valueOf(Math.max(1, (window.resetAt() - now) / 1000)));
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"message\":\"요청이 너무 많습니다. 잠시 후 다시 시도해주세요.\"}");
            return;
        }
        chain.doFilter(req, res);
    }
}
