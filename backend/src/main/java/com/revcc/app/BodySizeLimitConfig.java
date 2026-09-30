package com.revcc.app;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.util.unit.DataSize;

/** 모든 /api 요청에 본문 크기 상한을 적용한다. 값은 application.yml의 app.request 참고. */
@Configuration
public class BodySizeLimitConfig {
    @Bean
    public FilterRegistrationBean<BodySizeLimitFilter> bodySizeLimitFilter(
            @Value("${app.request.max-body-size:64KB}") DataSize maxBody,
            @Value("${app.request.max-upload-size:5MB}") DataSize maxUpload) {
        FilterRegistrationBean<BodySizeLimitFilter> bean =
            new FilterRegistrationBean<>(new BodySizeLimitFilter(maxBody.toBytes(), maxUpload.toBytes()));
        bean.addUrlPatterns("/api/*");
        bean.setName("bodySizeLimitFilter");
        // rate limit(order 1)보다 먼저 실행해 본문을 읽기 전에 거부한다.
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return bean;
    }
}
