package com.revcc.app;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Duration;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class PasswordResetService {
    private final StringRedisTemplate redis;
    private final UserRepository users;
    private final ResetMailService mail;
    private final String secret;
    private final SecureRandom random = new SecureRandom();
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder();
    private static final DefaultRedisScript<Long> LIMIT = new DefaultRedisScript<>(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", Long.class);
    private static final DefaultRedisScript<String> VERIFY = new DefaultRedisScript<>(
        "local v=redis.call('GET',KEYS[1]); if not v then return nil end; " +
        "local n=redis.call('INCR',KEYS[2]); if n==1 then redis.call('EXPIRE',KEYS[2],300) end; " +
        "if n>5 then redis.call('DEL',KEYS[1]); return nil end; " +
        "local split=string.find(v,'|',1,true); if string.sub(v,1,split-1)~=ARGV[1] then return nil end; " +
        "redis.call('DEL',KEYS[1]); return string.sub(v,split+1)", String.class);
    public PasswordResetService(StringRedisTemplate redis, UserRepository users, ResetMailService mail,
            @Value("${app.password-reset.secret:}") String secret) {
        this.redis=redis; this.users=users; this.mail=mail; this.secret=secret;
    }
    public static String email(String value) { return value.trim().toLowerCase(Locale.ROOT); }
    private String digest(String value) {
        if (secret.length() < 32) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "메일 인증 설정이 필요합니다.");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) { throw new IllegalStateException("인증 처리 실패"); }
    }
    public void limit(String bucket, int max, int seconds) {
        Long count = redis.execute(LIMIT, List.of("password-reset-limit:" + digest(bucket)), String.valueOf(seconds));
        if (count == null || count > max) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "잠시 후 다시 시도해주세요.");
    }
    public void request(String input, String requester) {
        String email = email(input), key = digest(email);
        limit("request-ip:" + requester, 20, 3600);
        limit("request-email:" + email, 5, 3600);
        // Unknown and social-only accounts have the same response and rate-limit behavior.
        if (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent("password-reset-cooldown:"+key, "1", Duration.ofSeconds(60)))) return;
        User user = users.findByEmail(email).orElse(null);
        if (user == null || user.getKakaoId() != null) return;
        String code = String.format(Locale.ROOT, "%06d", random.nextInt(1000000));
        String payload = user.getId()+":"+user.getAuthVersion()+":"+key;
        redis.opsForValue().set("password-reset:"+key, digest(email+":"+code)+"|"+payload, Duration.ofMinutes(5));
        // Never log mail exceptions: SMTP diagnostics can contain recipients or message bodies.
        try { mail.send(email, code); }
        catch (RuntimeException e) { redis.delete("password-reset:"+key); }
    }
    public String verify(String input, String code, String requester) {
        String email=email(input), key=digest(email);
        limit("verify-ip:"+requester, 60, 300);
        String payload = redis.execute(VERIFY, List.of("password-reset:"+key, "password-reset-attempts:"+key), digest(email+":"+code));
        if (payload == null) throw invalid();
        byte[] bytes=new byte[32]; random.nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue().set("password-reset-token:"+digest(token), payload, Duration.ofMinutes(10));
        return token;
    }
    @Transactional
    public void reset(String token, String password, String confirm) {
        if (password == null || password.isBlank() || password.length()>255 || password.getBytes(StandardCharsets.UTF_8).length>72 || !password.equals(confirm))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "비밀번호 확인과 UTF-8 72바이트 제한을 확인해주세요.");
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw invalid();
        // Atomic GETDEL consumes the capability even if the subsequent DB operation fails: fail closed.
        String payload=redis.opsForValue().getAndDelete("password-reset-token:"+digest(token));
        if (payload == null) throw invalid();
        String[] parts=payload.split(":");
        User user=users.lockById(Long.valueOf(parts[0])).orElseThrow(PasswordResetService::invalid);
        if (user.getKakaoId()!=null || user.getEmail()==null || user.getAuthVersion()!=Long.parseLong(parts[1]) || !digest(user.getEmail()).equals(parts[2])) throw invalid();
        user.upgradePassword(passwords.encode(password)); user.invalidateSessions(); users.saveAndFlush(user);
    }
    private static ResponseStatusException invalid() { return new ResponseStatusException(HttpStatus.BAD_REQUEST, "인증 정보가 올바르지 않거나 만료되었습니다. 다시 요청해주세요."); }
}
