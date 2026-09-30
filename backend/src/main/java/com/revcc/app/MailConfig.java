package com.revcc.app;
import org.springframework.context.annotation.*;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
@Configuration
@EnableAsync
public class MailConfig {
    @Bean("resetMailExecutor")
    public ThreadPoolTaskExecutor resetMailExecutor() {
        ThreadPoolTaskExecutor executor=new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2); executor.setMaxPoolSize(2); executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("reset-mail-");
        return executor;
    }
}
