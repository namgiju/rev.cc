package com.revcc.app;

import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.data.redis.core.*;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PasswordResetRequestTest {
    UserRepository users=mock(UserRepository.class);
    ResetMailService mail=mock(ResetMailService.class);
    StringRedisTemplate redis=mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked") ValueOperations<String,String> values=mock(ValueOperations.class);
    MockMvc mvc;
    @BeforeEach void setup() {
        when(redis.opsForValue()).thenReturn(values);
        when(redis.execute(any(RedisScript.class),anyList(),any(Object[].class))).thenReturn(1L);
        when(values.setIfAbsent(anyString(),anyString(),any(java.time.Duration.class))).thenReturn(true);
        User user=new User("owner","hash"); user.registerEmail("owner@example.test");
        when(users.findByUsername("owner")).thenReturn(Optional.of(user));
        var service=new PasswordResetService(redis,users,mail,"test-secret-with-at-least-32-characters");
        mvc=MockMvcBuilders.standaloneSetup(new PasswordResetController(service)).setControllerAdvice(new MemberExceptionHandler()).build();
    }
    @Test void matchingUsernameAndNormalizedEmailSendCode() throws Exception {
        request("owner","OWNER@example.test",200,"CODE_SENT","인증번호를 발송했습니다.");
        verify(mail).send(eq("owner@example.test"),matches("[0-9]{6}"));
        verify(values).set(startsWith("password-reset:"),anyString(),eq(java.time.Duration.ofMinutes(5)));
    }
    @Test void mismatchesAndUnknownAccountsAreExplicitAndNeverSend() throws Exception {
        request("missing","owner@example.test",400,"USERNAME_NOT_FOUND","등록되지 않은 아이디입니다.");
        request("owner","another@example.test",400,"IDENTITY_MISMATCH","아이디와 이메일 정보가 일치하지 않습니다.");
        request("owner","missing@example.test",400,"IDENTITY_MISMATCH","아이디와 이메일 정보가 일치하지 않습니다.");
        request("missing","missing@example.test",400,"USERNAME_NOT_FOUND","등록되지 않은 아이디입니다.");
        verifyNoInteractions(mail);
        verify(values,never()).set(anyString(),anyString(),any(java.time.Duration.class));
        verify(users,never()).findByEmail(anyString());
    }
    @Test void socialOnlyAccountDoesNotSend() throws Exception {
        User user=new User("social","hash",77L);user.registerEmail("owner@example.test");
        when(users.findByUsername("social")).thenReturn(Optional.of(user));
        request("social","owner@example.test",400,"SOCIAL_ACCOUNT","카카오 계정은 카카오 로그인을 이용해주세요.");verifyNoInteractions(mail);
    }
    @Test void requestRequiresUsernameAndValidEmail() throws Exception {
        for(String body:List.of("{\"email\":\"owner@example.test\"}","{\"username\":\"  \",\"email\":\"owner@example.test\"}","{\"username\":\"owner\",\"email\":\"invalid\"}"))
            mvc.perform(post("/api/auth/password-reset/request").contentType("application/json").content(body)).andExpect(status().isBadRequest());
        verifyNoInteractions(users,mail);
    }
    @Test void requestRateLimitRemainsSeparateAndStopsDbAndMail() throws Exception {
        when(redis.execute(any(RedisScript.class),anyList(),any(Object[].class))).thenReturn(21L);
        request("owner","owner@example.test",429,"RATE_LIMITED","요청이 많습니다. 잠시 후 다시 시도해주세요.");
        verifyNoInteractions(users,mail);
    }
    @Test void cooldownDoesNotPretendAnotherCodeWasSent() throws Exception {
        when(values.setIfAbsent(anyString(),anyString(),any(java.time.Duration.class))).thenReturn(false);
        request("owner","owner@example.test",429,"RATE_LIMITED","요청이 많습니다. 잠시 후 다시 시도해주세요.");
        verifyNoInteractions(mail);
        verify(values,never()).set(anyString(),anyString(),any(java.time.Duration.class));
    }
    @Test void dispatchFailureDoesNotReportCodeSent() throws Exception {
        doThrow(new org.springframework.core.task.TaskRejectedException("test queue full")).when(mail).send(anyString(),anyString());
        request("owner","owner@example.test",503,"MAIL_UNAVAILABLE","메일 발송 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
        verify(redis).delete(startsWith("password-reset:"));
    }
    void request(String username,String email,int expectedStatus,String code,String message) throws Exception {
        mvc.perform(post("/api/auth/password-reset/request").contentType("application/json").content("{\"username\":\""+username+"\",\"email\":\""+email+"\"}"))
            .andExpect(status().is(expectedStatus)).andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.message").value(message));
    }
}
