package com.revcc.app;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RateLimitFilterTest {
    @Test void allowsUpToLimitThenRejectsWithinWindow() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(Duration.ofMinutes(1), 2);
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRequestURI()).thenReturn("/api/auth/login");
        when(request.getRemoteAddr()).thenReturn("203.0.113.5");
        FilterChain chain = mock(FilterChain.class);
        StringWriter body = new StringWriter();
        HttpServletResponse blocked = mock(HttpServletResponse.class);
        when(blocked.getWriter()).thenReturn(new PrintWriter(body));

        filter.doFilter(request, mock(HttpServletResponse.class), chain);
        filter.doFilter(request, mock(HttpServletResponse.class), chain);
        filter.doFilter(request, blocked, chain);

        verify(chain, times(2)).doFilter(any(), any());
        verify(blocked).setStatus(429);
        assertTrue(body.toString().contains("요청이 너무 많습니다"));
    }

    @Test void tracksDifferentIpsAndPathsInSeparateBuckets() throws Exception {
        RateLimitFilter filter = new RateLimitFilter(Duration.ofMinutes(1), 1);
        FilterChain chain = mock(FilterChain.class);
        HttpServletRequest fromA = mock(HttpServletRequest.class);
        when(fromA.getRequestURI()).thenReturn("/api/auth/login");
        when(fromA.getRemoteAddr()).thenReturn("203.0.113.5");
        HttpServletRequest fromB = mock(HttpServletRequest.class);
        when(fromB.getRequestURI()).thenReturn("/api/auth/login");
        when(fromB.getRemoteAddr()).thenReturn("203.0.113.9");
        HttpServletRequest signupFromA = mock(HttpServletRequest.class);
        when(signupFromA.getRequestURI()).thenReturn("/api/auth/signup");
        when(signupFromA.getRemoteAddr()).thenReturn("203.0.113.5");

        filter.doFilter(fromA, mock(HttpServletResponse.class), chain);
        filter.doFilter(fromB, mock(HttpServletResponse.class), chain);
        filter.doFilter(signupFromA, mock(HttpServletResponse.class), chain);

        verify(chain, times(3)).doFilter(any(), any());
    }
}
