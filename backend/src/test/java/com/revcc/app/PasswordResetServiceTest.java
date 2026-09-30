package com.revcc.app;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Opt-in real Redis test. Never connects to the application Redis or clears its database. */
class PasswordResetServiceTest {
    LettuceConnectionFactory factory;
    StringRedisTemplate redis;
    UserRepository users;
    ResetMailService mail;
    PasswordResetService service;
    User user;
    String email;
    AtomicReference<String> code;
    @BeforeEach void setup() {
        Assumptions.assumeTrue(System.getenv("REVCC_TEST_REDIS_PORT") != null, "Set isolated test Redis port to execute integration tests");
        factory=new LettuceConnectionFactory("127.0.0.1",Integer.parseInt(System.getenv("REVCC_TEST_REDIS_PORT")));
        factory.afterPropertiesSet(); redis=new StringRedisTemplate(factory);
        users=mock(UserRepository.class); mail=mock(ResetMailService.class);
        service=new PasswordResetService(redis,users,mail,"test-only-secret-at-least-32-characters");
        email=UUID.randomUUID()+"@example.test"; user=new User("tester", "old");
        ReflectionTestUtils.setField(user,"id",42L); user.registerEmail(email);
        when(users.findByUsername("tester")).thenReturn(Optional.of(user)); when(users.lockById(42L)).thenReturn(Optional.of(user));
        code=new AtomicReference<>(); doAnswer(c -> { code.set(c.getArgument(1)); return null; }).when(mail).send(eq(email),anyString());
    }
    @AfterEach void close() { if(factory!=null) factory.destroy(); }
    String requestAndVerify() {
        service.request("tester",email,email); assertTrue(code.get().matches("[0-9]{6}"));
        return service.verify(email,code.get(),email);
    }
    @Test void fullFlowHashesPasswordAndInvalidatesSessionsAndTokens() {
        String token=requestAndVerify();
        assertThrows(ResponseStatusException.class,()->service.verify(email,code.get(),email));
        service.reset(token,"new-password","new-password");
        assertTrue(new BCryptPasswordEncoder().matches("new-password",user.getPassword()));
        assertEquals(1,user.getAuthVersion());
        assertThrows(ResponseStatusException.class,()->service.reset(token,"another-password","another-password"));
    }
    @Test void withdrawnAccountCannotRequestOrCompleteAReset() {
        // 탈퇴 전에 받아 둔 재설정 토큰도 탈퇴 후에는 쓸 수 없다(비밀번호가 바뀌지 않는다).
        String token=requestAndVerify(); String before=user.getPassword();
        user.markWithdrawn(java.time.Instant.now());
        assertThrows(ResponseStatusException.class,()->service.reset(token,"new-password","new-password"));
        assertEquals(before,user.getPassword());
        // 요청은 없는 아이디와 같은 응답이다(쿨다운 60초를 피하려고 새 이메일로 요청한다).
        var failure=assertThrows(PasswordResetService.RequestFailure.class,()->service.request("tester","other-"+email,"other-"+email));
        assertEquals("USERNAME_NOT_FOUND",failure.code());
    }
    @Test void failuresLimitedToFiveEvenWithCorrectSixthAttempt() {
        service.request("tester",email,email);
        String wrong=code.get().equals("000000")?"000001":"000000";
        for(int i=0;i<5;i++) assertThrows(ResponseStatusException.class,()->service.verify(email,wrong,email));
        assertThrows(ResponseStatusException.class,()->service.verify(email,code.get(),email));
    }
    @Test void requestsAreThrottledAndUnknownAccountsNeverSendMail() {
        service.request("tester",email,email);
        for(int i=1;i<5;i++) assertEquals(429,assertThrows(ResponseStatusException.class,()->service.request("tester",email,email)).getStatusCode().value());
        verify(mail,times(1)).send(eq(email),anyString());
        assertEquals(429,assertThrows(ResponseStatusException.class,()->service.request("tester",email,email)).getStatusCode().value());
        assertEquals(400,assertThrows(ResponseStatusException.class,()->service.request("missing", "missing-"+email,"other-"+email)).getStatusCode().value());
        verifyNoMoreInteractions(mail);
    }
    @Test void concurrentVerificationIssuesOnlyOneToken() throws Exception {
        service.request("tester",email,email);
        try(var executor=Executors.newFixedThreadPool(2)) {
            Callable<Boolean> attempt=()-> {try {service.verify(email,code.get(),email);return true;}catch(ResponseStatusException e){return false;}};
            var results=executor.invokeAll(List.of(attempt,attempt));
            assertNotEquals(results.get(0).get(),results.get(1).get());
        }
    }
    @Test void invalidPasswordDoesNotConsumeTokenAndChangedAccountRejectsIt() {
        String token=requestAndVerify();
        assertThrows(ResponseStatusException.class,()->service.reset(token,"a","b"));
        user.invalidateSessions();
        assertThrows(ResponseStatusException.class,()->service.reset(token,"valid-password","valid-password"));
        assertEquals("old",user.getPassword());
    }
    @Test void ttlAndHashedValuesAndExpiry() throws Exception {
        service.request("tester",email,email);
        // Locate only this test's random account by its ID/version payload; never flush Redis.
        String key=redis.keys("password-reset:*").stream().filter(k->redis.opsForValue().get(k).contains("|42:0:") &&
            redis.opsForValue().get(k).endsWith(k.substring("password-reset:".length()))).filter(k -> {
                try { var mac=javax.crypto.Mac.getInstance("HmacSHA256"); mac.init(new javax.crypto.spec.SecretKeySpec("test-only-secret-at-least-32-characters".getBytes(),"HmacSHA256")); return k.endsWith(HexFormat.of().formatHex(mac.doFinal(email.getBytes()))); } catch(Exception e) {throw new RuntimeException(e);}
            }).findFirst().orElseThrow();
        assertTrue(redis.getExpire(key)>290 && redis.getExpire(key)<=300);
        assertFalse(redis.opsForValue().get(key).startsWith(code.get()+"|"));
        String token=service.verify(email,code.get(),email);
        var mac=javax.crypto.Mac.getInstance("HmacSHA256"); mac.init(new javax.crypto.spec.SecretKeySpec("test-only-secret-at-least-32-characters".getBytes(),"HmacSHA256"));
        String tokenKey="password-reset-token:"+HexFormat.of().formatHex(mac.doFinal(token.getBytes()));
        assertTrue(redis.getExpire(tokenKey)>590 && redis.getExpire(tokenKey)<=600);
        redis.expire(tokenKey,Duration.ofMillis(1)); Thread.sleep(20);
        assertThrows(ResponseStatusException.class,()->service.reset(token,"valid-password","valid-password"));
        redis.opsForValue().set(key,"expired",Duration.ofMillis(1)); Thread.sleep(20);
        assertThrows(ResponseStatusException.class,()->service.verify(email,code.get(),email));
    }
}
