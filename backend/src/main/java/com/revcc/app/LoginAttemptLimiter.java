package com.revcc.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * 아이디 단위 로그인 실패 제한. IP 기준 RateLimitFilter와 함께 쓰여, IP를 바꿔 가며 한 계정을 계속 시도하는 것을 막는다.
 * 존재하지 않는 아이디도 똑같이 세어 응답으로 계정 존재 여부가 드러나지 않게 한다.
 * PasswordResetService의 제한과 같이 Redis INCR + EXPIRE 고정 윈도를 쓰며, 성공해도 카운터를 지우지 않고 만료만 기다린다
 * (영구 잠금 없음). 한도에 도달하는 순간 TTL을 다시 LOCK_SECONDS로 잡아 그때부터 LOCK_SECONDS 동안 막는다.
 * 여러 서버 인스턴스와 재시작 사이에서도 유지되도록 인메모리가 아니라 Redis에 둔다.
 */
@Component
public class LoginAttemptLimiter {
    static final int MAX_FAILURES = 5;
    static final int LOCK_SECONDS = 15 * 60;
    private static final DefaultRedisScript<Long> RECORD = new DefaultRedisScript<>(
        "local n=redis.call('INCR',KEYS[1]); " +
        "if n==1 or n==tonumber(ARGV[2]) then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", Long.class);
    private final StringRedisTemplate redis;

    public LoginAttemptLimiter(StringRedisTemplate redis) { this.redis = redis; }

    /** 막혀 있으면 남은 초(1 이상), 아니면 0. */
    public long lockedSeconds(String username) { return lockedSecondsFor(key(username)); }

    public void recordFailure(String username) { recordFailureFor(key(username)); }

    // 회원 탈퇴 비밀번호 확인(STEP 10-impl-C)도 같은 한도(5회/15분)를 쓰되 로그인과 다른 키(withdraw-fail:<회원 id>)로 센다.
    public long withdrawLockedSeconds(long userId) { return lockedSecondsFor(withdrawKey(userId)); }

    public void recordWithdrawFailure(long userId) { recordFailureFor(withdrawKey(userId)); }

    static String withdrawKey(long userId) { return "withdraw-fail:" + userId; }

    private long lockedSecondsFor(String key) {
        String count = redis.opsForValue().get(key);
        if (count == null || Long.parseLong(count) < MAX_FAILURES) return 0;
        Long ttl = redis.getExpire(key);
        return ttl == null || ttl < 1 ? 1 : ttl;
    }

    private void recordFailureFor(String key) {
        redis.execute(RECORD, List.of(key), String.valueOf(LOCK_SECONDS), String.valueOf(MAX_FAILURES));
    }

    // 로그인과 같은 값을 쓴다: 아이디는 대소문자를 구분하고 trim하지 않는다(AuthController.checkUsername 참고).
    static String key(String username) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(username.getBytes(StandardCharsets.UTF_8));
            return "login-fail:" + HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
