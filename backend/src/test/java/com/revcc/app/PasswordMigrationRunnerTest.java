package com.revcc.app;

import org.junit.jupiter.api.Test;
import org.springframework.boot.ApplicationArguments;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PasswordMigrationRunnerTest {
    private final UserRepository users = mock(UserRepository.class);
    private final PasswordMigrationRunner runner = new PasswordMigrationRunner(users);
    private final ApplicationArguments args = mock(ApplicationArguments.class);

    @Test void migratesRemainingPlaintextPasswordsAtStartup() {
        User legacy = new User("legacy", "plaintext-secret");
        User alreadyHashed = new User("already", new BCryptPasswordEncoder().encode("hashed"));
        when(users.findAll()).thenReturn(List.of(legacy, alreadyHashed));
        runner.run(args);
        assertTrue(new BCryptPasswordEncoder().matches("plaintext-secret", legacy.getPassword()));
        verify(users).saveAll(List.of(legacy));
    }

    @Test void leavesPasswordsTooLongForBcryptUntouched() {
        String tooLong = "x".repeat(80);
        assertTrue(tooLong.getBytes(StandardCharsets.UTF_8).length > 72);
        User oversized = new User("legacy2", tooLong);
        when(users.findAll()).thenReturn(List.of(oversized));
        runner.run(args);
        assertEquals(tooLong, oversized.getPassword());
        verify(users, never()).saveAll(any());
    }

    @Test void doesNothingWhenNoLegacyAccountsExist() {
        when(users.findAll()).thenReturn(List.of(new User("modern", new BCryptPasswordEncoder().encode("x"))));
        runner.run(args);
        verify(users, never()).saveAll(any());
    }
}
