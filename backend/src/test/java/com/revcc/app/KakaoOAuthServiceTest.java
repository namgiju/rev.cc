package com.revcc.app;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** authorizeUrl이 state를 카카오 인가 URL에 실제로 실어 보내는지 회귀 검증한다(P0-1). */
class KakaoOAuthServiceTest {
    @Test void authorizeUrlIncludesGivenState() {
        KakaoOAuthService service = new KakaoOAuthService(new ObjectMapper(), "client-id", "", "https://rev.cc/api/auth/kakao/callback");
        String url = service.authorizeUrl("test-state-value");
        assertTrue(url.contains("state=test-state-value"), url);
        assertTrue(url.contains("client_id=client-id"), url);
        assertTrue(url.contains("redirect_uri=https%3A%2F%2Frev.cc%2Fapi%2Fauth%2Fkakao%2Fcallback"), url);
    }
}
