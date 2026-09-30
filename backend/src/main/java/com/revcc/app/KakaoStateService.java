package com.revcc.app;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

/** 카카오 로그인 시작~콜백 사이의 OAuth CSRF(로그인 CSRF/계정 혼동)를 막는 1회용 state.
 * Redis를 신뢰 저장소로 쓰고(revcc:session:*과 같은 계약), 같은 값을 단기 HttpOnly 쿠키로
 * 요청 브라우저에 묶어 "공격자가 자기 자신의 유효한 state를 피해자에게 재생"하는 공격을 막는다. */
@Service
public class KakaoStateService {
    public static final String COOKIE = "REVCC_OAUTH_STATE";
    private static final String KEY_PREFIX = "revcc:oauth:state:";
    private static final Duration TTL = Duration.ofMinutes(5);

    private final StringRedisTemplate redis;
    private final boolean secure;
    private final SecureRandom random = new SecureRandom();

    public KakaoStateService(StringRedisTemplate redis, @Value("${app.session.secure:false}") boolean secure) {
        this.redis = redis;
        this.secure = secure;
    }

    public String issue() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String state = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue().set(KEY_PREFIX + state, "1", TTL);
        return state;
    }

    /** state가 형식에 맞고, 쿠키 값과 일치하고, Redis에 아직 살아있으면 즉시 폐기(1회용)한 뒤 true.
     * 없음/불일치/만료/재사용은 모두 false — 어떤 경우인지는 호출자에게 구분해 알려주지 않는다. */
    public boolean verify(String state, String cookieState) {
        if (state == null || cookieState == null || !valid(state) || !state.equals(cookieState)) return false;
        return redis.opsForValue().getAndDelete(KEY_PREFIX + state) != null;
    }

    public String cookie(String state) {
        return ResponseCookie.from(COOKIE, state).path("/api/auth/kakao").httpOnly(true)
            .sameSite("Lax").secure(secure).maxAge(TTL).build().toString();
    }

    public String clearCookie() {
        return ResponseCookie.from(COOKIE, "").path("/api/auth/kakao").httpOnly(true)
            .sameSite("Lax").secure(secure).maxAge(Duration.ZERO).build().toString();
    }

    private boolean valid(String value) {
        return value.matches("[A-Za-z0-9_-]{43}");
    }
}
