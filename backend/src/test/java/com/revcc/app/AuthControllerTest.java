package com.revcc.app;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 기존 계정 이전과 비밀번호 해시를 검증하며 실제 DB는 통합 테스트에서 검증한다. */
class AuthControllerTest {
    private final UserRepository users = mock(UserRepository.class);
    private final SharedSessionService sessions = mock(SharedSessionService.class);
    private final KakaoOAuthService kakao = mock(KakaoOAuthService.class);
    private final KakaoStateService kakaoState = mock(KakaoStateService.class);
    private final AuthController controller = new AuthController(users, sessions, kakao, kakaoState);

    @Test void signupStoresHash() {
        when(users.saveAndFlush(any())).thenAnswer(call -> {
            User user = call.getArgument(0);
            assertTrue(new BCryptPasswordEncoder().matches("secret", user.getPassword()));
            User saved = mock(User.class);
            when(saved.getId()).thenReturn(1L);
            when(saved.getUsername()).thenReturn(user.getUsername());
            return saved;
        });
        assertEquals(201, controller.signup(new AuthController.Credentials("test", "secret")).getStatusCode().value());
    }

    @Test void legacyLoginUpgradesPasswordAndRotatesSession() {
        User user = new User("test", "legacy");
        when(users.lockByUsername("test")).thenReturn(Optional.of(user));
        when(sessions.create(user)).thenReturn("new-token");
        when(sessions.cookie("new-token", false)).thenReturn("REVCC_SESSION=new-token");
        assertEquals(200, controller.login(new AuthController.Credentials("test", "legacy"), "old-token").getStatusCode().value());
        assertTrue(new BCryptPasswordEncoder().matches("legacy", user.getPassword()));
        verify(users).saveAndFlush(user);
        verify(sessions).revoke("old-token");
    }

    @Test void wrongPasswordNeverCreatesSession() {
        when(users.lockByUsername("test")).thenReturn(Optional.of(new User("test", "secret")));
        assertEquals(401, controller.login(new AuthController.Credentials("test", "wrong"), null).getStatusCode().value());
        verifyNoInteractions(sessions);
    }

    @Test void kakaoUsesExistingSessionAndReturnsAdminForAdmin() throws Exception {
        User admin = mock(User.class);
        when(admin.getRole()).thenReturn("ADMIN");
        when(admin.getUsername()).thenReturn("kakao-owner");
        when(kakaoState.verify("good-state", "good-state")).thenReturn(true);
        when(kakaoState.clearCookie()).thenReturn("REVCC_OAUTH_STATE=; Max-Age=0");
        when(kakao.exchange("test-code")).thenReturn(new KakaoOAuthService.KakaoUser(77L, "kakao-owner"));
        when(users.lockByKakaoId(77L)).thenReturn(Optional.of(admin));
        when(sessions.create(admin)).thenReturn("oauth-session");
        when(sessions.cookie("oauth-session", false)).thenReturn("REVCC_SESSION=oauth-session; HttpOnly");
        var response = controller.kakaoCallback("test-code", "good-state", "good-state");
        assertEquals(302, response.getStatusCode().value());
        assertEquals("/admin", response.getHeaders().getLocation().toString());
        var cookies = response.getHeaders().get(HttpHeaders.SET_COOKIE);
        assertTrue(cookies.stream().anyMatch(c -> c.startsWith("REVCC_SESSION=oauth-session") && c.contains("HttpOnly")));
        assertTrue(cookies.stream().anyMatch(c -> c.startsWith("REVCC_OAUTH_STATE=")));
        verify(sessions).create(admin);
    }

    @Test void kakaoRegularUserReturnsMainWithExistingSession() throws Exception {
        User user=new User("kakao-member","hash",78L);
        when(kakaoState.verify("good-state", "good-state")).thenReturn(true);
        when(kakaoState.clearCookie()).thenReturn("REVCC_OAUTH_STATE=; Max-Age=0");
        when(kakao.exchange("test-code")).thenReturn(new KakaoOAuthService.KakaoUser(78L,"kakao-member"));
        when(users.lockByKakaoId(78L)).thenReturn(Optional.of(user));
        when(sessions.create(user)).thenReturn("user-session");
        when(sessions.cookie("user-session",false)).thenReturn("REVCC_SESSION=user-session; HttpOnly");
        var response=controller.kakaoCallback("test-code", "good-state", "good-state");
        assertEquals(302,response.getStatusCode().value());
        assertEquals("/",response.getHeaders().getLocation().toString());
        verify(sessions).create(user);
    }

    @Test void kakaoEntryIssuesStateAndSetsCookieOnRedirect() {
        when(kakaoState.issue()).thenReturn("issued-state");
        when(kakaoState.cookie("issued-state")).thenReturn("REVCC_OAUTH_STATE=issued-state; HttpOnly; Path=/api/auth/kakao");
        when(kakao.authorizeUrl("issued-state")).thenReturn("https://kauth.kakao.com/oauth/authorize?client_id=test&state=issued-state");
        var response = controller.kakaoLogin();
        assertEquals(302, response.getStatusCode().value());
        assertEquals("https://kauth.kakao.com/oauth/authorize?client_id=test&state=issued-state",
            response.getHeaders().getLocation().toString());
        assertTrue(response.getHeaders().get(HttpHeaders.SET_COOKIE).stream()
            .anyMatch(c -> c.equals("REVCC_OAUTH_STATE=issued-state; HttpOnly; Path=/api/auth/kakao")));
    }

    @Test void kakaoCallbackRejectsMissingState() {
        when(kakaoState.verify(null, null)).thenReturn(false);
        when(kakaoState.clearCookie()).thenReturn("REVCC_OAUTH_STATE=; Max-Age=0");
        var response = controller.kakaoCallback("test-code", null, null);
        assertEquals(400, response.getStatusCode().value());
        verifyNoInteractions(kakao);
        verifyNoInteractions(sessions);
    }

    @Test void kakaoCallbackRejectsStateThatDoesNotMatchCookie() {
        // 공격자가 자신의 인가코드+state를 피해자 브라우저에 강제 요청시키는 시나리오:
        // 피해자 브라우저에는 공격자의 state 쿠키가 없으므로 불일치로 거부되어야 한다.
        when(kakaoState.verify("attacker-state", "victim-state")).thenReturn(false);
        when(kakaoState.clearCookie()).thenReturn("REVCC_OAUTH_STATE=; Max-Age=0");
        var response = controller.kakaoCallback("test-code", "attacker-state", "victim-state");
        assertEquals(400, response.getStatusCode().value());
        verifyNoInteractions(kakao);
        verifyNoInteractions(sessions);
    }

    @Test void unknownAccountAndWrongPasswordHaveSameMessage() {
        when(users.lockByUsername("known")).thenReturn(Optional.of(new User("known", "secret")));
        assertEquals(controller.login(new AuthController.Credentials("known", "wrong"), null).getBody(),
            controller.login(new AuthController.Credentials("unknown", "wrong"), null).getBody());
        verifyNoInteractions(sessions);
    }
}
