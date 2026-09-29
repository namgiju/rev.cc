package com.revcc.app;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 카카오 OAuth state 발급/검증. Redis가 신뢰 저장소, 쿠키는 브라우저 바인딩용 이중 확인. */
class KakaoStateServiceTest {

    @Test void validStateMatchingCookieIsAcceptedAndConsumedOnce() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        String state = "a".repeat(43);
        // 첫 조회는 유효, 두 번째(재사용 시도)는 이미 삭제되어 null.
        when(values.getAndDelete("revcc:oauth:state:" + state)).thenReturn("1", (String) null);
        KakaoStateService service = new KakaoStateService(redis, false);

        assertTrue(service.verify(state, state), "정상 state는 로그인 진행이 허용되어야 한다");
        assertFalse(service.verify(state, state), "이미 사용한 state는 재사용을 거부해야 한다");
    }

    @Test void missingStateIsRejectedWithoutTouchingRedis() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        KakaoStateService service = new KakaoStateService(redis, false);
        String cookieOnly = "a".repeat(43);

        assertFalse(service.verify(null, cookieOnly), "state 파라미터 없음은 거부되어야 한다");
        assertFalse(service.verify(cookieOnly, null), "state 쿠키 없음도 거부되어야 한다");
        verifyNoInteractions(redis);
    }

    @Test void stateNotMatchingCookieIsRejected() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        KakaoStateService service = new KakaoStateService(redis, false);

        // 공격자가 자신의 정상 state를 피해자 브라우저에 재생하는 시나리오: 쿠키는 다르므로 거부.
        assertFalse(service.verify("e".repeat(43), "f".repeat(43)));
        verify(values, never()).getAndDelete(anyString());
    }

    @Test void expiredStateIsRejected() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        String state = "c".repeat(43);
        // TTL이 지나 Redis에서 이미 사라진 상태를 흉내낸다.
        when(values.getAndDelete("revcc:oauth:state:" + state)).thenReturn(null);
        KakaoStateService service = new KakaoStateService(redis, false);

        assertFalse(service.verify(state, state), "만료된 state는 거부되어야 한다");
    }

    @Test void malformedStateIsRejectedWithoutTouchingRedis() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        KakaoStateService service = new KakaoStateService(redis, false);

        assertFalse(service.verify("too-short", "too-short"));
        verifyNoInteractions(redis);
    }

    @Test void issueStoresThirtyTwoByteTokenWithFiveMinuteTtl() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        KakaoStateService service = new KakaoStateService(redis, false);

        String state = service.issue();

        assertTrue(state.matches("[A-Za-z0-9_-]{43}"), "32바이트 SecureRandom → base64url 43자여야 한다");
        verify(values).set(eq("revcc:oauth:state:" + state), eq("1"), eq(Duration.ofMinutes(5)));
    }

    @Test void cookieIsHttpOnlyAndScopedToKakaoEndpoints() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        KakaoStateService secureService = new KakaoStateService(redis, true);
        String cookie = secureService.cookie("d".repeat(43));

        assertTrue(cookie.contains("HttpOnly"));
        assertTrue(cookie.contains("Secure"));
        assertTrue(cookie.contains("Path=/api/auth/kakao"));
        assertFalse(cookie.toLowerCase().contains("samesite=none"));
    }
}
