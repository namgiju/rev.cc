package com.revcc.app;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 재가입 제한 HMAC과 비밀값 누락 시 동작(안전하지 않은 대체 동작 없음). DB 없이 검증한다. */
class WithdrawalBlocksTest {
    static final String SECRET = "unit-test-withdrawal-secret-32-characters!";
    final JdbcTemplate jdbc = mock(JdbcTemplate.class);

    @Test void hmacIsKeyedTypedAndHex() {
        WithdrawalBlocks a = new WithdrawalBlocks(jdbc, SECRET, false), b = new WithdrawalBlocks(jdbc, SECRET + "x", false);
        String value = a.hmac(WithdrawalBlocks.Type.EMAIL, "user@example.com");
        assertTrue(value.matches("[0-9a-f]{64}"));
        assertEquals(value, a.hmac(WithdrawalBlocks.Type.EMAIL, "user@example.com"));
        assertNotEquals(value, a.hmac(WithdrawalBlocks.Type.USERNAME, "user@example.com"), "type is part of the input");
        assertNotEquals(value, b.hmac(WithdrawalBlocks.Type.EMAIL, "user@example.com"), "depends on the secret");
        assertFalse(value.contains("example"));
    }

    @Test void missingSecretNeverFallsBackToAnUnkeyedHash() {
        assertThrows(IllegalStateException.class, () -> new WithdrawalBlocks(jdbc, "", true), "prod refuses to start");
        assertThrows(IllegalStateException.class, () -> new WithdrawalBlocks(jdbc, "too-short", true));
        WithdrawalBlocks missing = new WithdrawalBlocks(jdbc, "short", false);
        assertFalse(missing.configured());
        assertEquals(503, assertThrows(ResponseStatusException.class, () -> missing.hmac(WithdrawalBlocks.Type.EMAIL, "a@b.c")).getStatusCode().value());
        // 살아 있는 제한 행이 있으면 비교할 수 없으므로 가입 확인을 503으로 막는다. 없으면 제한할 대상이 없다.
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenReturn(true);
        assertEquals(503, assertThrows(ResponseStatusException.class, () -> missing.blocked(WithdrawalBlocks.Type.EMAIL, "a@b.c")).getStatusCode().value());
        when(jdbc.queryForObject(anyString(), eq(Boolean.class))).thenReturn(false);
        assertFalse(missing.blocked(WithdrawalBlocks.Type.EMAIL, "a@b.c"));
        assertFalse(missing.blocked(WithdrawalBlocks.Type.EMAIL, null));
    }

    @Test void withdrawalIsRefusedBeforeTouchingTheAccountWhenTheSecretIsMissing() {
        UserRepository users = mock(UserRepository.class);
        WithdrawalService service = new WithdrawalService(users, jdbc, new WithdrawalBlocks(jdbc, "", false), mock(AdminMemberActionRepository.class));
        var error = assertThrows(ResponseStatusException.class, () -> service.withdraw(1L, 0, "pw", stored -> true, () -> {}));
        assertEquals(503, error.getStatusCode().value());
        verifyNoInteractions(users);
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }
}
