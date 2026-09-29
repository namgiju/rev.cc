package com.revcc.app;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.Cookie;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named="REVCC_TEST_DB_PORT",matches="[0-9]+")
class MemberFlowIntegrationTest {
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url",()->"jdbc:postgresql://127.0.0.1:"+System.getenv("REVCC_TEST_DB_PORT")+"/revcc_test");
        r.add("spring.datasource.username",()->"postgres"); r.add("spring.datasource.password",()->"test");
        r.add("spring.data.redis.host",()->"127.0.0.1"); r.add("spring.data.redis.port",()->System.getenv("REVCC_TEST_REDIS_PORT"));
        r.add("app.password-reset.secret",()->"integration-test-secret-at-least-32-characters");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired UserRepository users;
    @MockitoBean ResetMailService mail;
    JsonNode json(MvcResult result) throws Exception { return mapper.readTree(result.getResponse().getContentAsString()); }
    Cookie login(String name,String password) throws Exception {
        var result=mvc.perform(post("/api/auth/login").contentType("application/json").content(mapper.writeValueAsString(Map.of("username",name,"password",password)))).andExpect(status().isOk()).andReturn();
        return result.getResponse().getCookie(SharedSessionService.COOKIE);
    }
    String body(Object o) throws Exception {return mapper.writeValueAsString(o);}
    @Test void concurrentSignupCreatesOnlyOneAccount() throws Exception {
        String name="signup-race-"+UUID.randomUUID();
        String request=body(Map.of("username",name,"password","race-password"));
        try(var executor=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<Integer> signup=()->mvc.perform(post("/api/auth/signup").contentType("application/json").content(request)).andReturn().getResponse().getStatus();
            var futures=executor.invokeAll(List.of(signup,signup));
            var statuses=new java.util.HashSet<Integer>();for(var f:futures) statuses.add(f.get());
            assertEquals(Set.of(201,409),statuses);
            assertTrue(users.findByUsername(name).isPresent());
        }
    }
    @Test void serverPaginationAndSearchRespectFieldAndStatus() throws Exception {
        String prefix="page-"+UUID.randomUUID();
        User admin=new User(prefix+"-admin",new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode("admin"));
        admin.manage(null,null,"ACTIVE","ADMIN",null);users.saveAndFlush(admin);
        Cookie cookie=login(admin.getUsername(),"admin");
        for(int i=0;i<25;i++) {
            User member=new User(prefix+"-member-"+i,"unused-test-hash");
            member.manage("nickname-"+i,prefix+i+"@example.test",i==0?"DISABLED":"ACTIVE","USER",null);users.save(member);
        }
        var first=json(mvc.perform(get("/api/admin/members").cookie(cookie).param("q",prefix+"-member")).andExpect(status().isOk()).andReturn());
        assertEquals(25,first.get("total").asInt());assertEquals(20,first.get("items").size());
        var second=json(mvc.perform(get("/api/admin/members").cookie(cookie).param("q",prefix+"-member").param("page","2")).andExpect(status().isOk()).andReturn());
        assertEquals(5,second.get("items").size());
        var filtered=json(mvc.perform(get("/api/admin/members").cookie(cookie).param("q",prefix).param("status","DISABLED")).andExpect(status().isOk()).andReturn());
        assertEquals(1,filtered.get("total").asInt());
        mvc.perform(get("/api/admin/members").cookie(cookie).param("page","0")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/admin/members").cookie(cookie).param("field","password")).andExpect(status().isBadRequest());
    }
    @Test void completeAdminAndResetFlowPreservesOtherAccountsAndRevokesEverySession() throws Exception {
        String name="member-"+UUID.randomUUID(), email=name+"@example.test", adminName="admin-"+UUID.randomUUID();
        mvc.perform(post("/api/auth/signup").contentType("application/json").content(body(Map.of("username",name,"password","before","email",email)))).andExpect(status().isCreated());
        User member=users.findByUsername(name).orElseThrow();
        User admin=new User(adminName,new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode("admin-pass"));
        admin.manage(null,null,"ACTIVE","ADMIN",null); admin=users.saveAndFlush(admin);
        Cookie a=login(adminName,"admin-pass"), first=login(name,"before"), second=login(name,"before");
        mvc.perform(get("/api/admin/members")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/admin/members").cookie(first)).andExpect(status().isForbidden());
        var listed=json(mvc.perform(get("/api/admin/members").cookie(a).param("q",email).param("field","email")).andExpect(status().isOk()).andReturn());
        assertEquals(1,listed.get("total").asInt()); assertFalse(listed.toString().contains("password"));
        mvc.perform(patch("/api/admin/members/"+member.getId()).cookie(first).contentType("application/json").content(body(Map.of("status","ACTIVE","role","ADMIN")))).andExpect(status().isForbidden());
        mvc.perform(patch("/api/admin/members/"+admin.getId()).cookie(a).contentType("application/json").content(body(Map.of("status","ACTIVE","role","USER")))).andExpect(status().isConflict());
        mvc.perform(patch("/api/admin/members/"+member.getId()).cookie(a).contentType("application/json").content(body(Map.of("nickname","닉네임","email",email,"status","ACTIVE","role","USER")))).andExpect(status().isOk());
        mvc.perform(get("/api/auth/me").cookie(first)).andExpect(status().isUnauthorized());
        first=login(name,"before"); second=login(name,"before");
        AtomicReference<String> code=new AtomicReference<>();
        doAnswer(c->{code.set(c.getArgument(1));return null;}).when(mail).send(eq(email),anyString());
        mvc.perform(post("/api/auth/password-reset/request").contentType("application/json").content(body(Map.of("username",name,"email",email)))).andExpect(status().isOk());
        mvc.perform(post("/api/admin/members/"+member.getId()+"/password-reset").cookie(a).contentType("application/json").content("{}")).andExpect(status().isTooManyRequests());
        assertNotNull(code.get());
        var token=json(mvc.perform(post("/api/auth/password-reset/verify").contentType("application/json").content(body(Map.of("email",email,"code",code.get())))).andExpect(status().isOk()).andReturn()).get("resetToken").asText();
        String reset=body(Map.of("token",token,"password","after","confirm","after"));
        mvc.perform(post("/api/auth/password-reset/complete").contentType("application/json").content(reset)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/password-reset/complete").contentType("application/json").content(reset)).andExpect(status().isBadRequest());
        mvc.perform(get("/api/auth/me").cookie(first)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").cookie(second)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").cookie(a)).andExpect(status().isOk());
        login(name,"after");
        mvc.perform(post("/api/auth/login").contentType("application/json").content(body(Map.of("username",name,"password","before")))).andExpect(status().isUnauthorized());
        assertEquals(1,json(mvc.perform(get("/api/admin/members/"+member.getId()+"/actions").cookie(a)).andExpect(status().isOk()).andReturn()).size());
        Cookie current=login(name,"after");
        mvc.perform(patch("/api/admin/members/"+member.getId()).cookie(a).contentType("application/json").content(body(Map.of("email",email,"status","SUSPENDED","role","USER")))).andExpect(status().isOk());
        mvc.perform(get("/api/auth/me").cookie(current)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login").contentType("application/json").content(body(Map.of("username",name,"password","after")))).andExpect(status().isUnauthorized());
    }
}
