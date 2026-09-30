package com.revcc.app;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * STEP 10-impl-A: 탈퇴(WITHDRAWN) 계정은 어떤 경로로도 다시 인증되지 않는다.
 * 실제 탈퇴 API는 아직 없으므로 User.markWithdrawn으로 상태만 만들어 검증한다(실 DB 흐름은 WithdrawnMemberIntegrationTest).
 */
class WithdrawnAccountAuthTest {
    private final UserRepository users = mock(UserRepository.class);
    private final SharedSessionService sessions = mock(SharedSessionService.class);
    private final KakaoOAuthService kakao = mock(KakaoOAuthService.class);
    private final KakaoStateService kakaoState = mock(KakaoStateService.class);
    private final LoginAttemptLimiter attempts = mock(LoginAttemptLimiter.class);
    private final AuthController controller = new AuthController(users, sessions, kakao, kakaoState, attempts,
        org.mockito.Mockito.mock(WithdrawalService.class), org.mockito.Mockito.mock(WithdrawalBlocks.class));

    private static User withdrawn(User user) { user.markWithdrawn(Instant.now()); return user; }

    @Test void markWithdrawnIsTerminalBlockedAndRevokesSessions() {
        User user = new User("member", "hash");
        user.manage(null, null, "ACTIVE", "ADMIN", null);
        long version = user.getAuthVersion();
        assertTrue(user.isEffectiveAdmin());
        user.markWithdrawn(Instant.parse("2026-10-01T00:00:00Z"));
        assertTrue(user.isWithdrawn());
        assertTrue(user.isBlocked());
        assertFalse(user.isEffectiveAdmin());
        assertEquals("WITHDRAWN", user.getAccountStatus());
        assertEquals(Instant.parse("2026-10-01T00:00:00Z"), user.getWithdrawnAt());
        assertEquals(version + 1, user.getAuthVersion());
        user.markWithdrawn(Instant.now()); // 두 번째 호출은 아무것도 바꾸지 않는다.
        assertEquals(version + 1, user.getAuthVersion());
        assertEquals(Instant.parse("2026-10-01T00:00:00Z"), user.getWithdrawnAt());
    }

    @Test void passwordLoginFailsWithTheSameResponseAsAWrongPassword() {
        String hash = new BCryptPasswordEncoder().encode("correct-pass");
        when(users.lockByUsername("gone")).thenReturn(Optional.of(withdrawn(new User("gone", hash))));
        when(users.lockByUsername("active")).thenReturn(Optional.of(new User("active", hash)));
        var refused = controller.login(new AuthController.Credentials("gone", "correct-pass"), null);
        var wrong = controller.login(new AuthController.Credentials("active", "wrong-pass"), null);
        assertEquals(401, refused.getStatusCode().value());
        assertEquals(wrong.getBody(), refused.getBody());
        verify(attempts).recordFailure("gone");
        verify(sessions, never()).create(any());
    }

    @Test void kakaoLoginIsRefusedWithoutTouchingTheAccount() throws Exception {
        User user = withdrawn(new User("kakao-gone", "hash", 91L));
        when(kakaoState.verify("s", "s")).thenReturn(true);
        when(kakaoState.clearCookie()).thenReturn("REVCC_OAUTH_STATE=; Max-Age=0");
        when(kakao.exchange("code")).thenReturn(new KakaoOAuthService.KakaoUser(91L, "새 닉네임"));
        when(users.lockByKakaoId(91L)).thenReturn(Optional.of(user));
        var response = controller.kakaoCallback("code", "s", "s");
        assertEquals(403, response.getStatusCode().value());
        assertEquals("kakao-gone", user.getUsername()); // 닉네임 갱신도 하지 않는다.
        verify(users, never()).saveAndFlush(any());
        verify(sessions, never()).create(any());
    }

    @Test void existingSessionOfAWithdrawnAccountIsRejectedAndDeleted() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        UserRepository repository = mock(UserRepository.class);
        User user = new User("member", "hash");
        when(repository.findById(1L)).thenReturn(Optional.of(user));
        String token = "c".repeat(43), key = "revcc:session:" + token;
        when(values.get(key)).thenReturn("{\"id\":1,\"username\":\"member\",\"role\":\"USER\",\"version\":0}");
        SharedSessionService service = new SharedSessionService(redis, new ObjectMapper(), false, repository);
        assertEquals(1L, service.require(token).id());
        // 같은 버전의 세션이어도(상태만 바뀐 경우) 거부한다. markWithdrawn은 버전도 올린다.
        ReflectionTestUtils.setField(user, "accountStatus", User.WITHDRAWN);
        assertEquals(401, assertThrows(ResponseStatusException.class, () -> service.require(token)).getStatusCode().value());
        verify(redis).delete(key);
    }

    @Test void reservedNamesCannotBeRegisteredOrReportedAsAvailable() {
        var response = controller.signup(new AuthController.Credentials("탈퇴한 회원", "secret-pass"));
        assertEquals(400, response.getStatusCode().value());
        assertEquals(Map.of("message", "사용할 수 없는 아이디입니다."), response.getBody());
        assertEquals(400, controller.signup(new AuthController.Credentials("ＡＤＭＩＮ", "secret-pass")).getStatusCode().value());
        verify(users, never()).saveAndFlush(any());
        assertEquals(Map.of("available", false), controller.checkUsername(new AuthController.UsernameQuery("탈퇴한​회원")).getBody());
        assertEquals(Map.of("available", true), controller.checkUsername(new AuthController.UsernameQuery("new-member")).getBody());
    }

    @Test void kakaoNicknamesThatLookLikeSystemNamesAreNotUsedAsUsernames() throws Exception {
        when(kakaoState.verify("s", "s")).thenReturn(true);
        when(kakaoState.clearCookie()).thenReturn("REVCC_OAUTH_STATE=; Max-Age=0");
        when(kakao.exchange("new")).thenReturn(new KakaoOAuthService.KakaoUser(12345L, "관리자"));
        when(users.lockByKakaoId(12345L)).thenReturn(Optional.empty());
        when(users.existsByUsername("카카오사용자")).thenReturn(true);
        when(users.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
        when(sessions.create(any())).thenReturn("t");
        when(sessions.cookie("t", false)).thenReturn("REVCC_SESSION=t; HttpOnly");
        assertEquals(302, controller.kakaoCallback("new", "s", "s").getStatusCode().value());
        verify(users).saveAndFlush(argThat(u -> "카카오사용자_2345".equals(u.getUsername())));

        User existing = new User("old-name", "hash", 777L);
        when(kakao.exchange("rename")).thenReturn(new KakaoOAuthService.KakaoUser(777L, "탈퇴한 회원"));
        when(users.lockByKakaoId(777L)).thenReturn(Optional.of(existing));
        assertEquals(302, controller.kakaoCallback("rename", "s", "s").getStatusCode().value());
        assertEquals("old-name", existing.getUsername());
    }

    @Test void publicVehicleProfileOfAWithdrawnOwnerIs404() {
        GarageVehicleRepository vehicles = mock(GarageVehicleRepository.class);
        User owner = new User("owner", "hash");
        ReflectionTestUtils.setField(owner, "id", 7L);
        Vehicle vehicle = new Vehicle(owner, new GarageVehicleRequest("Hyundai", "Avante", 2022, null, null, null, null, null, "12가3456"));
        when(vehicles.findById(15)).thenReturn(Optional.of(vehicle));
        GarageVehicleService service = new GarageVehicleService(vehicles, mock(UserRepository.class));
        assertEquals(7L, service.profile(15).userId());
        owner.markWithdrawn(Instant.now());
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> service.profile(15)).getStatusCode().value());
    }
}
