package com.revcc.app;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 기동 시 남아있는 평문 비밀번호를 즉시 BCrypt로 전환한다.
 * 로그인 시 이전 로직(AuthController)은 그대로 유지하되, 다시 로그인하지 않는 휴면 계정도
 * DB 덤프 유출 시 평문이 그대로 남지 않도록 배포 때마다 한 번 선제적으로 처리한다.
 */
@Component
public class PasswordMigrationRunner implements ApplicationRunner {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(PasswordMigrationRunner.class);
    private final UserRepository users;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder();

    public PasswordMigrationRunner(UserRepository users) {
        this.users = users;
    }

    @Override
    public void run(ApplicationArguments args) {
        List<User> migrated = new ArrayList<>();
        int skipped = 0;
        for (User user : users.findAll()) {
            if (isHash(user.getPassword())) continue;
            // BCrypt는 72바이트를 넘는 입력을 거부한다. 이런 계정은 로그인 시에도 이미
            // "기존 비밀번호 변경이 필요합니다" 응답으로 막혀 있으므로 그대로 두고 기록만 남긴다.
            if (user.getPassword().getBytes(StandardCharsets.UTF_8).length > 72) {
                skipped++;
                continue;
            }
            user.upgradePassword(passwords.encode(user.getPassword()));
            migrated.add(user);
        }
        if (!migrated.isEmpty()) users.saveAll(migrated);
        if (!migrated.isEmpty() || skipped > 0)
            log.info("Legacy password migration at startup: migrated={}, skippedTooLongForBcrypt={}",
                migrated.size(), skipped);
    }

    private boolean isHash(String value) { return value.matches("^\\$2[aby]\\$.*"); }
}
