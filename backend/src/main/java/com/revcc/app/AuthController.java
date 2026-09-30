package com.revcc.app;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;

/** 회원 저장은 PostgreSQL, 로그인 상태는 언어 중립 Redis 세션이 담당한다. */
@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AuthController.class);
    static final int MIN_PASSWORD_LENGTH = 8;
    private final UserRepository users;
    private final SharedSessionService sessions;
    private final KakaoOAuthService kakao;
    private final KakaoStateService kakaoState;
    private final LoginAttemptLimiter attempts;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder();

    public AuthController(UserRepository users, SharedSessionService sessions, KakaoOAuthService kakao, KakaoStateService kakaoState,
            LoginAttemptLimiter attempts) {
        this.users = users;
        this.sessions = sessions;
        this.kakao = kakao;
        this.kakaoState = kakaoState;
        this.attempts = attempts;
    }

    public record UsernameQuery(@NotBlank @Size(max = 100) String username) {}

    @GetMapping("/check-username")
    public ResponseEntity<?> checkUsername(@Valid @ModelAttribute UsernameQuery query) {
        // Same exact, case-sensitive value as signup/login; do not trim or lowercase it.
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store")
            .body(Map.of("available", !users.existsByUsername(query.username())));
    }

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@Valid @RequestBody Credentials request) {
        // 최소 길이는 새 비밀번호에만 적용한다. Credentials는 로그인과 공유하므로 @Size(min)을 걸면
        // 짧은 비밀번호를 쓰는 기존(레거시 평문 포함) 계정이 로그인하지 못하게 된다.
        if (request.password().length() < MIN_PASSWORD_LENGTH)
            return ResponseEntity.badRequest().body(Map.of("message", "비밀번호는 " + MIN_PASSWORD_LENGTH + "자 이상이어야 합니다."));
        // BCrypt는 UTF-8 72바이트 제한이 있어 문자 수와 별도로 검사한다.
        if (request.password().getBytes(StandardCharsets.UTF_8).length > 72)
            return ResponseEntity.badRequest().body(Map.of("message", "비밀번호는 UTF-8 72바이트 이하여야 합니다."));
        if (users.existsByUsername(request.username())) return duplicate();
        try {
            User fresh = new User(request.username(), passwords.encode(request.password()));
            if (request.email()!=null && !request.email().isBlank()) fresh.registerEmail(PasswordResetService.email(request.email()));
            User saved = users.saveAndFlush(fresh);
            return ResponseEntity.status(201).body(Map.of("id", saved.getId(), "username", saved.getUsername(), "message", "회원가입 성공"));
        } catch (DataIntegrityViolationException e) {
            // 동시에 같은 아이디로 가입해도 DB unique 제약을 409 응답으로 처리한다.
            return duplicate();
        }
    }

    @org.springframework.transaction.annotation.Transactional
    @PostMapping("/login")
    public ResponseEntity<?> login(@Valid @RequestBody Credentials request,
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String previous) {
        // 아이디 단위 실패 제한(IP 제한과 별개). 막힌 동안은 DB 조회나 비밀번호 검사 없이, 계정 존재 여부와 무관하게 같은 429.
        long locked = attempts.lockedSeconds(request.username());
        if (locked > 0)
            return ResponseEntity.status(429).header(HttpHeaders.RETRY_AFTER, String.valueOf(locked))
                .body(Map.of("message", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요."));
        User user = users.lockByUsername(request.username()).orElse(null);
        if (user == null || user.isBlocked() || !matches(request.password(), user.getPassword())) {
            attempts.recordFailure(request.username());
            return ResponseEntity.status(401).body(Map.of("message", "아이디 또는 비밀번호가 올바르지 않습니다."));
        }
        // 이미 저장된 평문 계정을 보존하면서 첫 로그인에 BCrypt로 마이그레이션한다.
        if (!isHash(user.getPassword())) {
            if (request.password().getBytes(StandardCharsets.UTF_8).length > 72)
                return ResponseEntity.badRequest().body(Map.of("message", "기존 비밀번호 변경이 필요합니다."));
            user.upgradePassword(passwords.encode(request.password()));
            users.saveAndFlush(user);
        }
        sessions.revoke(previous); // 재로그인 시 토큰을 회전해 세션 고정을 방지한다.
        String token = sessions.create(user);
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, sessions.cookie(token, false))
            .body(new SharedSessionService.SessionUser(user.getId(), user.getUsername(), user.getRole(), user.getAuthVersion()));
    }

    @GetMapping("/me")
    public SharedSessionService.SessionUser me(@CookieValue(name = SharedSessionService.COOKIE, required = false) String token) {
        return sessions.require(token);
    }

    @PostMapping("/logout")
    public ResponseEntity<?> logout(@CookieValue(name = SharedSessionService.COOKIE, required = false) String token) {
        sessions.revoke(token); // Redis 삭제 즉시 Express에서도 인증이 해제된다.
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, sessions.cookie("", true))
            .body(Map.of("message", "로그아웃되었습니다."));
    }

    @GetMapping("/kakao/login")
    public ResponseEntity<?> kakaoLogin() {
        String state = kakaoState.issue();
        return ResponseEntity.status(302).location(URI.create(kakao.authorizeUrl(state)))
            .header(HttpHeaders.SET_COOKIE, kakaoState.cookie(state)).build();
    }

    @org.springframework.transaction.annotation.Transactional
    @GetMapping("/kakao/callback")
    public ResponseEntity<?> kakaoCallback(@RequestParam String code,
            @RequestParam(required = false) String state,
            @CookieValue(name = KakaoStateService.COOKIE, required = false) String stateCookie) {
        // state 검증 실패(없음/불일치/만료/재사용)는 원인을 구분해 응답하지 않는다 — 토큰 재시도 힌트를 주지 않기 위함.
        if (!kakaoState.verify(state, stateCookie))
            return ResponseEntity.status(400).header(HttpHeaders.SET_COOKIE, kakaoState.clearCookie())
                .body(Map.of("message", "로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요."));
        try {
            KakaoOAuthService.KakaoUser info = kakao.exchange(code);
            // 닉네임은 바뀔 수 있으므로 카카오 ID로 같은 계정을 찾고, 처음이면 새로 만든다.
            User user = users.lockByKakaoId(info.id())
                .map(existing -> refreshKakaoNickname(existing, info))
                .orElseGet(() -> createKakaoUser(info));
            if (user.isBlocked()) return ResponseEntity.status(403).header(HttpHeaders.SET_COOKIE, kakaoState.clearCookie())
                .body(Map.of("message", "이용할 수 없는 계정입니다."));
            String token = sessions.create(user);
            return ResponseEntity.status(302).location(URI.create("ADMIN".equals(user.getRole()) ? "/admin" : "/"))
                .header(HttpHeaders.SET_COOKIE, sessions.cookie(token, false))
                .header(HttpHeaders.SET_COOKIE, kakaoState.clearCookie()).build();
        } catch (Exception e) {
            log.warn("Kakao login failed: {}", e instanceof KakaoOAuthService.OAuthFailure
                ? e.getMessage() : e.getClass().getSimpleName());
            return ResponseEntity.status(502).header(HttpHeaders.SET_COOKIE, kakaoState.clearCookie())
                .body(Map.of("message", "카카오 로그인에 실패했습니다."));
        }
    }

    private User refreshKakaoNickname(User user, KakaoOAuthService.KakaoUser info) {
        String nickname = info.nickname();
        // 카카오 동의항목이 나중에 켜져 실제 닉네임을 받게 되면 다음 로그인 때 자동으로 반영한다.
        // 다른 계정이 이미 그 이름을 쓰고 있으면 충돌을 피해 그대로 둔다.
        if (!nickname.equals(user.getUsername()) && !users.existsByUsername(nickname)) {
            user.updateUsername(nickname);
            users.saveAndFlush(user);
        }
        return user;
    }

    private User createKakaoUser(KakaoOAuthService.KakaoUser info) {
        String username = info.nickname();
        // 닉네임이 이미 다른 계정에서 쓰이는 중이면 카카오 ID 뒷자리를 붙여 구분한다.
        if (users.existsByUsername(username)) username = username + "_" + (info.id() % 10000);
        // 카카오 로그인 전용 계정은 비밀번호로 직접 로그인하지 않으므로 무작위 해시만 채워둔다.
        return users.saveAndFlush(new User(username, passwords.encode(UUID.randomUUID().toString()), info.id()));
    }

    private boolean isHash(String value) { return value.matches("^\\$2[aby]\\$.*"); }
    private boolean matches(String raw, String stored) {
        if (isHash(stored)) return raw.getBytes(StandardCharsets.UTF_8).length <= 72 && passwords.matches(raw, stored);
        return MessageDigest.isEqual(raw.getBytes(StandardCharsets.UTF_8), stored.getBytes(StandardCharsets.UTF_8));
    }
    private ResponseEntity<?> duplicate() {
        return ResponseEntity.status(409).body(Map.of("message", "이미 존재하는 아이디 또는 이메일입니다."));
    }
    public record Credentials(@NotBlank @Size(max = 100) String username,
                              @NotBlank @Size(max = 255) String password,
                              @jakarta.validation.constraints.Email @Size(max=254) String email) {
        @Override public String toString() { return "Credentials[redacted]"; }
        public Credentials(String username, String password) { this(username,password,null); }
    }
}
