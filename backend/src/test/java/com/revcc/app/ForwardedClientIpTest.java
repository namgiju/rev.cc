package com.revcc.app;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.filter.ForwardedHeaderFilter;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;

/**
 * forward-headers-strategy=framework(ForwardedHeaderFilter)는 X-Forwarded-For의 첫 번째 값을
 * 클라이언트 IP로 쓴다. 그래서 nginx가 클라이언트가 보낸 X-Forwarded-For 뒤에 덧붙이면 클라이언트가
 * rate limit 버킷을 고를 수 있다. nginx/default.conf는 X-Forwarded-For를 $remote_addr로 덮어써
 * core에는 nginx가 본 주소 하나만 도착한다. nginx 쪽 동작은 scripts/nginx-forwarded-check.sh로 확인한다.
 */
class ForwardedClientIpTest {
    private static final String CLIENT = "203.0.113.9";

    private static MockHttpServletResponse login(RateLimitFilter limiter, String forwardedFor) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/login");
        request.setRemoteAddr("172.18.0.5"); // nginx 컨테이너
        request.addHeader("X-Forwarded-For", forwardedFor);
        MockHttpServletResponse response = new MockHttpServletResponse();
        new ForwardedHeaderFilter().doFilter(request, response,
            (req, res) -> limiter.doFilter(req, res, new MockFilterChain()));
        return response;
    }

    private static String clientIpSeenBySpring(String forwardedFor) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/login");
        request.setRemoteAddr("172.18.0.5");
        request.addHeader("X-Forwarded-For", forwardedFor);
        String[] seen = new String[1];
        new ForwardedHeaderFilter().doFilter(request, new MockHttpServletResponse(),
            (req, res) -> seen[0] = ((HttpServletRequest) req).getRemoteAddr());
        return seen[0];
    }

    @Test void springTrustsTheFirstForwardedForValue() throws Exception {
        // 덧붙이기($proxy_add_x_forwarded_for): 클라이언트 값이 앞에 온다.
        assertEquals("198.51.100.1", clientIpSeenBySpring("198.51.100.1, " + CLIENT));
        // 덮어쓰기($remote_addr): nginx가 본 주소만 온다.
        assertEquals(CLIENT, clientIpSeenBySpring(CLIENT));
    }

    @Test void appendedForwardedForLetsClientRotateBuckets() throws Exception {
        RateLimitFilter limiter = new RateLimitFilter(Duration.ofMinutes(1), 2);
        for (int i = 0; i < 5; i++)
            assertEquals(200, login(limiter, "198.51.100." + i + ", " + CLIENT).getStatus());
    }

    @Test void overwrittenForwardedForKeepsOneBucketPerClient() throws Exception {
        RateLimitFilter limiter = new RateLimitFilter(Duration.ofMinutes(1), 2);
        assertEquals(200, login(limiter, CLIENT).getStatus());
        assertEquals(200, login(limiter, CLIENT).getStatus());
        assertEquals(429, login(limiter, CLIENT).getStatus());
    }
}
