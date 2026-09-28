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
    private final UserRepository users;
    private final SharedSessionService sessions;
    private final KakaoOAuthService kakao;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder();

    public AuthController(UserRepository users, SharedSessionService sessions, KakaoOAuthService kakao) {
        this.users = users;
        this.sessions = sessions;
        this.kakao = kakao;
    }

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@Valid @RequestBody Credentials request) {
        // BCrypt는 UTF-8 72바이트 제한이 있어 문자 수와 별도로 검사한다.
        if (request.password().getBytes(StandardCharsets.UTF_8).length > 72)
            return ResponseEntity.badRequest().body(Map.of("message", "비밀번호는 UTF-8 72바이트 이하여야 합니다."));
        if (users.existsByUsername(request.username())) return duplicate();
        try {
            User saved = users.saveAndFlush(new User(request.username(), passwords.encode(request.password())));
            return ResponseEntity.status(201).body(Map.of("id", saved.getId(), "username", saved.getUsername(), "message", "회원가입 성공"));
        } catch (DataIntegrityViolationException e) {
            // 동시에 같은 아이디로 가입해도 DB unique 제약을 409 응답으로 처리한다.
            return duplicate();
        }
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@Valid @RequestBody Credentials request,
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String previous) {
        User user = users.findByUsername(request.username()).orElse(null);
        if (user == null || !matches(request.password(), user.getPassword()))
            return ResponseEntity.status(401).body(Map.of("message", "아이디 또는 비밀번호가 올바르지 않습니다."));
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
            .body(new SharedSessionService.SessionUser(user.getId(), user.getUsername(), user.getRole()));
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
        return ResponseEntity.status(302).location(URI.create(kakao.authorizeUrl())).build();
    }

    @GetMapping("/kakao/callback")
    public ResponseEntity<?> kakaoCallback(@RequestParam String code) {
        try {
            KakaoOAuthService.KakaoUser info = kakao.exchange(code);
            // 닉네임은 바뀔 수 있으므로 카카오 ID로 같은 계정을 찾고, 처음이면 새로 만든다.
            User user = users.findByKakaoId(info.id())
                .map(existing -> refreshKakaoNickname(existing, info))
                .orElseGet(() -> createKakaoUser(info));
            String token = sessions.create(user);
            return ResponseEntity.status(302).location(URI.create("/home"))
                .header(HttpHeaders.SET_COOKIE, sessions.cookie(token, false)).build();
        } catch (Exception e) {
            log.warn("Kakao login failed: {}", e instanceof KakaoOAuthService.OAuthFailure
                ? e.getMessage() : e.getClass().getSimpleName());
            return ResponseEntity.status(502).body(Map.of("message", "카카오 로그인에 실패했습니다."));
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
        return ResponseEntity.status(409).body(Map.of("message", "이미 존재하는 아이디입니다."));
    }
    public record Credentials(@NotBlank @Size(max = 100) String username,
                              @NotBlank @Size(max = 255) String password) {}
}
