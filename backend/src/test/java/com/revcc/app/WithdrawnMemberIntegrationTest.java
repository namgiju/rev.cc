package com.revcc.app;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * STEP 10-impl-A를 실제 PostgreSQL(Flyway V1~V3)과 Redis로 검증한다.
 * 탈퇴 API는 아직 없으므로 User.markWithdrawn으로 WITHDRAWN 상태를 만든다.
 * 관리자 수는 DB 전체 기준이라, 관리자 관련 테스트는 시작할 때 기존 관리자를 일반 회원으로 돌린다(격리 테스트 DB 전용).
 */
@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named="REVCC_TEST_DB_PORT",matches="[0-9]+")
class WithdrawnMemberIntegrationTest {
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url",()->"jdbc:postgresql://127.0.0.1:"+System.getenv("REVCC_TEST_DB_PORT")+"/revcc_test");
        r.add("spring.datasource.username",()->"postgres"); r.add("spring.datasource.password",()->"test");
        r.add("spring.data.redis.host",()->"127.0.0.1"); r.add("spring.data.redis.port",()->System.getenv("REVCC_TEST_REDIS_PORT"));
        r.add("app.password-reset.secret",()->"integration-test-secret-at-least-32-characters");
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;
    @Autowired SharedSessionService sessions;
    private static final BCryptPasswordEncoder BCRYPT = new BCryptPasswordEncoder();

    String body(Object o) throws Exception { return mapper.writeValueAsString(o); }
    JsonNode json(MvcResult r) throws Exception { return mapper.readTree(r.getResponse().getContentAsString()); }
    // 로그인 IP 제한은 테스트 클래스끼리 공유하는 Spring 컨텍스트에 있다. 이 클래스의 로그인 요청은 별도 주소에서 보낸다.
    MockHttpServletRequestBuilder loginRequest(String name, String password) throws Exception {
        return post("/api/auth/login").with(r -> { r.setRemoteAddr("198.51.100.210"); return r; })
            .contentType("application/json").content(body(Map.of("username",name,"password",password)));
    }
    Cookie login(String name, String password) throws Exception {
        return mvc.perform(loginRequest(name,password)).andExpect(status().isOk()).andReturn().getResponse().getCookie(SharedSessionService.COOKIE);
    }
    // 로그인 API는 IP당 분당 10회 제한(모든 테스트 요청이 같은 주소)이 있어, 로그인 자체를 검증하지 않는 테스트는
    // 로그인 성공 시와 같은 방법(SharedSessionService.create)으로 세션을 만든다.
    Cookie session(User user) { return new Cookie(SharedSessionService.COOKIE, sessions.create(users.findById(user.getId()).orElseThrow())); }
    User create(String prefix, String role) {
        User user=new User(prefix+"-"+UUID.randomUUID(),BCRYPT.encode("password-1"));
        if ("ADMIN".equals(role)) user.manage(null,null,"ACTIVE","ADMIN",null);
        return users.saveAndFlush(user);
    }
    void withdraw(User user) { User fresh=users.findById(user.getId()).orElseThrow(); fresh.markWithdrawn(Instant.now()); users.saveAndFlush(fresh); }
    int effectiveAdmins() {
        return jdbc.queryForObject("SELECT count(*) FROM users WHERE role='ADMIN' AND COALESCE(account_status,'ACTIVE')='ACTIVE'",Integer.class);
    }
    ResultActions patchMember(Cookie actor, Long id, Map<String,Object> change) throws Exception {
        return mvc.perform(patch("/api/admin/members/"+id).cookie(actor).contentType("application/json").content(body(change)));
    }

    @Test void schemaAcceptsOnlyKnownStatusesAndRecordsWithdrawnAt() {
        User user=create("status","USER");
        assertThrows(DataIntegrityViolationException.class,()->jdbc.update("UPDATE users SET account_status='DELETED' WHERE id=?",user.getId()));
        withdraw(user);
        Map<String,Object> row=jdbc.queryForMap("SELECT account_status,withdrawn_at FROM users WHERE id=?",user.getId());
        assertEquals("WITHDRAWN",row.get("account_status"));
        assertNotNull(row.get("withdrawn_at"));
    }

    @Test void withdrawnMemberCannotLoginOrUseAnyExistingSession() throws Exception {
        User user=create("gone","USER");
        Cookie first=login(user.getUsername(),"password-1"), second=login(user.getUsername(),"password-1");
        mvc.perform(get("/api/auth/me").cookie(first)).andExpect(status().isOk());
        withdraw(user);
        mvc.perform(get("/api/auth/me").cookie(first)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").cookie(second)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/garage/vehicles").cookie(second)).andExpect(status().isUnauthorized());
        var refused=mvc.perform(loginRequest(user.getUsername(),"password-1")).andExpect(status().isUnauthorized()).andReturn();
        assertNull(refused.getResponse().getCookie(SharedSessionService.COOKIE));
        assertEquals("아이디 또는 비밀번호가 올바르지 않습니다.",json(refused).get("message").asText());
    }

    @Test void adminCannotRestoreOrEditAWithdrawnMember() throws Exception {
        User admin=create("restore-admin","ADMIN"), member=create("restore-member","USER");
        Cookie a=session(admin);
        withdraw(member);
        for (String status : List.of("ACTIVE","SUSPENDED","DISABLED"))
            patchMember(a,member.getId(),Map.of("status",status,"role","USER")).andExpect(status().isConflict());
        patchMember(a,member.getId(),Map.of("status","ACTIVE","role","ADMIN")).andExpect(status().isConflict());
        patchMember(a,member.getId(),Map.of("nickname","new","email","restore@example.test","status","ACTIVE","role","USER")).andExpect(status().isConflict());
        // WITHDRAWN은 관리자가 지정할 수 있는 값이 아니다.
        User other=create("restore-other","USER");
        patchMember(a,other.getId(),Map.of("status","WITHDRAWN","role","USER")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/admin/members/"+member.getId()+"/password-reset").cookie(a).contentType("application/json").content("{}")).andExpect(status().isConflict());
        User after=users.findById(member.getId()).orElseThrow();
        assertEquals("WITHDRAWN",after.getAccountStatus());
        assertEquals("USER",after.getRole());
        assertNull(after.getEmail());
        // 기본 목록에서는 빠지고, 상태 필터로는 조회된다. 회원 수에서도 빠진다.
        assertEquals(0,json(mvc.perform(get("/api/admin/members").cookie(a).param("q",member.getUsername())).andExpect(status().isOk()).andReturn()).get("total").asInt());
        var filtered=json(mvc.perform(get("/api/admin/members").cookie(a).param("q",member.getUsername()).param("status","WITHDRAWN")).andExpect(status().isOk()).andReturn());
        assertEquals(1,filtered.get("total").asInt());
        assertEquals("WITHDRAWN",filtered.get("items").get(0).get("status").asText());
        long total=json(mvc.perform(get("/api/admin/overview").cookie(a)).andExpect(status().isOk()).andReturn()).get("totalUsers").asLong();
        assertEquals(jdbc.queryForObject("SELECT count(*) FROM users WHERE COALESCE(account_status,'ACTIVE')<>'WITHDRAWN'",Long.class),total);
        // 일반 회원 관리는 그대로 동작한다.
        patchMember(a,other.getId(),Map.of("nickname","닉","status","SUSPENDED","role","USER")).andExpect(status().isOk());
    }

    @Test void lastAdminCannotBeDemotedAndASecondAdminCanBe() throws Exception {
        jdbc.update("UPDATE users SET role='USER' WHERE role='ADMIN'");
        User first=create("last-admin-a","ADMIN");
        Cookie a=session(first);
        assertEquals(1,effectiveAdmins());
        // 관리자가 1명일 때: 자기 자신을 강등·정지할 수 없다.
        patchMember(a,first.getId(),Map.of("status","ACTIVE","role","USER")).andExpect(status().isConflict());
        patchMember(a,first.getId(),Map.of("status","DISABLED","role","ADMIN")).andExpect(status().isConflict());
        assertEquals(1,effectiveAdmins());
        // 관리자가 2명이면 한 명은 강등할 수 있다.
        User second=create("last-admin-b","ADMIN");
        Cookie b=session(second);
        assertEquals(2,effectiveAdmins());
        patchMember(a,second.getId(),Map.of("status","ACTIVE","role","USER")).andExpect(status().isOk());
        assertEquals(1,effectiveAdmins());
        mvc.perform(get("/api/admin/members").cookie(b)).andExpect(status().isUnauthorized()); // 강등으로 세션도 끝난다
        // 정지된 관리자는 관리자 수에 들어가지 않는다: 다시 승격 후 정지해도 마지막 유효 관리자는 남는다.
        patchMember(a,second.getId(),Map.of("status","ACTIVE","role","ADMIN")).andExpect(status().isOk());
        patchMember(a,second.getId(),Map.of("status","SUSPENDED","role","ADMIN")).andExpect(status().isOk());
        assertEquals(1,effectiveAdmins());
        patchMember(a,first.getId(),Map.of("status","ACTIVE","role","USER")).andExpect(status().isConflict());
    }

    @Test void concurrentMutualDemotionNeverLeavesZeroAdmins() throws Exception {
        for (int round=0; round<8; round++) {
            jdbc.update("UPDATE users SET role='USER' WHERE role='ADMIN'");
            User x=create("race-a","ADMIN"), y=create("race-b","ADMIN");
            Cookie cx=session(x), cy=session(y);
            // 짝수 회차는 서로 강등, 홀수 회차는 서로 비활성화한다.
            String role=round%2==0?"USER":"ADMIN", state=round%2==0?"ACTIVE":"DISABLED";
            CyclicBarrier start=new CyclicBarrier(2);
            try (ExecutorService pool=Executors.newFixedThreadPool(2)) {
                Callable<Integer> xDemotesY=()->{ start.await(); return patchMember(cx,y.getId(),Map.of("status",state,"role",role)).andReturn().getResponse().getStatus(); };
                Callable<Integer> yDemotesX=()->{ start.await(); return patchMember(cy,x.getId(),Map.of("status",state,"role",role)).andReturn().getResponse().getStatus(); };
                List<Integer> statuses=new ArrayList<>();
                for (Future<Integer> f : pool.invokeAll(List.of(xDemotesY,yDemotesX))) statuses.add(f.get());
                assertEquals(1,statuses.stream().filter(s->s==200).count(),"round "+round+": "+statuses);
                assertTrue(statuses.stream().allMatch(s->s==200||s==401||s==403||s==409),"round "+round+": "+statuses);
            }
            assertEquals(1,effectiveAdmins(),"round "+round);
        }
    }
}
