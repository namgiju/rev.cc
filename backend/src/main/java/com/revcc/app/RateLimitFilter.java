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

/**
 * 인메모리 고정 윈도우(fixed window) rate limiter. core 인스턴스가 하나뿐인 현재 배포 구조를 전제로 하며,
 * 여러 인스턴스로 수평 확장하면 Redis 등 공유 저장소로 교체해야 한다.
 * nginx가 X-Forwarded-For를 전달하고 server.forward-headers-strategy=framework가 이를 반영하므로
 * request.getRemoteAddr()는 프록시가 아닌 실제 클라이언트 IP를 가리킨다.
 */
public class RateLimitFilter implements Filter {
    private record Window(long resetAt, AtomicLong count) {}
    private final Map<String, Window> hits = new ConcurrentHashMap<>();
    private final long windowMs;
    private final int max;

    public RateLimitFilter(Duration window, int max) {
        this.windowMs = window.toMillis();
        this.max = max;
    }

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;
        String key = request.getRequestURI() + '|' + request.getRemoteAddr();
        long now = System.currentTimeMillis();
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
