package com.revcc.app;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.time.Duration;

/** 로그인/회원가입 브루트포스·계정 존재 여부 스캔을 막는 기본적인 IP당 rate limit. */
@Configuration
public class RateLimitConfig {
    @Bean
    public FilterRegistrationBean<RateLimitFilter> authRateLimitFilter() {
        FilterRegistrationBean<RateLimitFilter> bean =
            new FilterRegistrationBean<>(new RateLimitFilter(Duration.ofMinutes(1), 10));
        bean.addUrlPatterns("/api/auth/login", "/api/auth/signup", "/api/auth/check-username");
        bean.setName("authRateLimitFilter");
        bean.setOrder(1);
        return bean;
    }
}
