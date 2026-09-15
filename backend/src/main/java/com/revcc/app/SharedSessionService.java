package com.revcc.app;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

/** 공통 계약: revcc:session:<토큰> → {id, username}, 고정 만료 30분.
 * Java 전용 직렬화를 쓰지 않아 Express가 같은 Redis 값을 직접 읽는다. */
@Service
public class SharedSessionService {
    public static final String COOKIE = "REVCC_SESSION";
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final boolean secure;
    private final SecureRandom random = new SecureRandom();

    public SharedSessionService(StringRedisTemplate redis, ObjectMapper mapper,
            @Value("${app.session.secure:false}") boolean secure) {
        this.redis = redis;
        this.mapper = mapper;
        this.secure = secure;
    }

    public String create(User user) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        try {
            redis.opsForValue().set("revcc:session:" + token,
                mapper.writeValueAsString(new SessionUser(user.getId(), user.getUsername())), Duration.ofMinutes(30));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("세션 직렬화 실패", e);
        }
        return token;
    }

    public SessionUser require(String token) {
        String json = valid(token) ? redis.opsForValue().get("revcc:session:" + token) : null;
        if (json != null) {
            try { return mapper.readValue(json, SessionUser.class); }
            catch (JsonProcessingException e) { revoke(token); }
        }
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다.");
    }

    public void revoke(String token) {
        if (valid(token)) redis.delete("revcc:session:" + token);
    }

    private boolean valid(String token) {
        return token != null && token.matches("[A-Za-z0-9_-]{43}");
    }

    public String cookie(String token, boolean clear) {
        return ResponseCookie.from(COOKIE, clear ? "" : token).path("/").httpOnly(true)
            .sameSite("Lax").secure(secure).maxAge(clear ? Duration.ZERO : Duration.ofMinutes(30)).build().toString();
    }

    public record SessionUser(Long id, String username) {}
}
