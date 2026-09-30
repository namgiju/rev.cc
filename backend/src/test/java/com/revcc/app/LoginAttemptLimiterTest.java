package com.revcc.app;

import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import static org.junit.jupiter.api.Assertions.*;

/** Opt-in real Redis test for the Lua counter. Uses random usernames and deletes only its own keys. */
class LoginAttemptLimiterTest {
    LettuceConnectionFactory factory;
    StringRedisTemplate redis;
    LoginAttemptLimiter limiter;
    String username;

    @BeforeEach void setup() {
        Assumptions.assumeTrue(System.getenv("REVCC_TEST_REDIS_PORT") != null, "Set isolated test Redis port to execute integration tests");
        factory = new LettuceConnectionFactory("127.0.0.1", Integer.parseInt(System.getenv("REVCC_TEST_REDIS_PORT")));
        factory.afterPropertiesSet();
        redis = new StringRedisTemplate(factory);
        limiter = new LoginAttemptLimiter(redis);
        username = "login-test-" + UUID.randomUUID();
    }

    @AfterEach void close() {
        if (factory == null) return;
        redis.delete(LoginAttemptLimiter.key(username));
        redis.delete(LoginAttemptLimiter.key(username.toUpperCase()));
        factory.destroy();
    }

    @Test void locksOnlyAfterFiveFailures() {
        for (int i = 0; i < LoginAttemptLimiter.MAX_FAILURES - 1; i++) limiter.recordFailure(username);
        assertEquals(0, limiter.lockedSeconds(username));
        limiter.recordFailure(username);
        long locked = limiter.lockedSeconds(username);
        assertTrue(locked > LoginAttemptLimiter.LOCK_SECONDS - 5 && locked <= LoginAttemptLimiter.LOCK_SECONDS, "locked=" + locked);
    }

    @Test void lockLastsFifteenMinutesFromTheFifthFailure() {
        for (int i = 0; i < LoginAttemptLimiter.MAX_FAILURES - 1; i++) limiter.recordFailure(username);
        // 첫 실패로 시작한 윈도가 거의 끝나 가도, 5번째 실패 시점부터 다시 15분 동안 막아야 한다.
        redis.expire(LoginAttemptLimiter.key(username), 10, TimeUnit.SECONDS);
        limiter.recordFailure(username);
        assertTrue(redis.getExpire(LoginAttemptLimiter.key(username)) > LoginAttemptLimiter.LOCK_SECONDS - 5);
    }

    @Test void firstFailureStartsAFifteenMinuteWindow() {
        limiter.recordFailure(username);
        long ttl = redis.getExpire(LoginAttemptLimiter.key(username));
        assertTrue(ttl > LoginAttemptLimiter.LOCK_SECONDS - 5 && ttl <= LoginAttemptLimiter.LOCK_SECONDS, "ttl=" + ttl);
    }

    @Test void usernamesAreExactAndCaseSensitiveLikeLogin() {
        for (int i = 0; i < LoginAttemptLimiter.MAX_FAILURES; i++) limiter.recordFailure(username);
        assertTrue(limiter.lockedSeconds(username) > 0);
        assertEquals(0, limiter.lockedSeconds(username.toUpperCase()));
        assertEquals(0, limiter.lockedSeconds(" " + username));
        assertFalse(LoginAttemptLimiter.key(username).contains(username), "raw username must not appear in the Redis key");
    }
}
