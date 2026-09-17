package com.revcc.app;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 기존 계정 이전과 비밀번호 해시를 검증하며 실제 DB는 통합 테스트에서 검증한다. */
class AuthControllerTest {
    private final UserRepository users = mock(UserRepository.class);
    private final SharedSessionService sessions = mock(SharedSessionService.class);
    private final KakaoOAuthService kakao = mock(KakaoOAuthService.class);
    private final AuthController controller = new AuthController(users, sessions, kakao);

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
        when(users.findByUsername("test")).thenReturn(Optional.of(user));
        when(sessions.create(user)).thenReturn("new-token");
        when(sessions.cookie("new-token", false)).thenReturn("REVCC_SESSION=new-token");
        assertEquals(200, controller.login(new AuthController.Credentials("test", "legacy"), "old-token").getStatusCode().value());
        assertTrue(new BCryptPasswordEncoder().matches("legacy", user.getPassword()));
        verify(users).saveAndFlush(user);
        verify(sessions).revoke("old-token");
    }

    @Test void wrongPasswordNeverCreatesSession() {
        when(users.findByUsername("test")).thenReturn(Optional.of(new User("test", "secret")));
        assertEquals(401, controller.login(new AuthController.Credentials("test", "wrong"), null).getStatusCode().value());
        verifyNoInteractions(sessions);
    }
}
