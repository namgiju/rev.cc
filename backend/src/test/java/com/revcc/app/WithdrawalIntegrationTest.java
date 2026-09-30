package com.revcc.app;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.*;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * STEP 10-impl-C 회원 탈퇴를 실제 PostgreSQL(Flyway V1~V5)과 Redis로 검증한다. 테이블별 결과를 결정표(REVCC_NEXT_TASKS.md STEP 10)와 대조한다.
 * 게시판 공개 화면에서의 표시(탈퇴한 회원·id 숨김·사진 공개·닫힌 매물 비공개)는 board 시스템 테스트(withdrawal-system.mjs)가 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named="REVCC_TEST_DB_PORT",matches="[0-9]+")
class WithdrawalIntegrationTest {
    static final String SECRET = "withdrawal-integration-secret-at-least-32-chars";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url",()->"jdbc:postgresql://127.0.0.1:"+System.getenv("REVCC_TEST_DB_PORT")+"/revcc_test");
        r.add("spring.datasource.username",()->"postgres"); r.add("spring.datasource.password",()->"test");
        r.add("spring.data.redis.host",()->"127.0.0.1"); r.add("spring.data.redis.port",()->System.getenv("REVCC_TEST_REDIS_PORT"));
        r.add("app.password-reset.secret",()->"integration-test-secret-at-least-32-characters");
        r.add("app.withdrawal.hmac-secret",()->SECRET);
    }
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;
    @Autowired SharedSessionService sessions;
    @Autowired StringRedisTemplate redis;
    @Autowired PasswordResetService resets;
    @Autowired WithdrawalService withdrawals;
    @Autowired WithdrawalBlocks blocks;
    @MockitoBean ResetMailService mail;
    private static final BCryptPasswordEncoder BCRYPT = new BCryptPasswordEncoder();
    private static final AtomicInteger ADDRESS = new AtomicInteger(1);

    String body(Object o) throws Exception { return mapper.writeValueAsString(o); }
    JsonNode json(MvcResult r) throws Exception { return mapper.readTree(r.getResponse().getContentAsString()); }
    // /api/auth/withdraw·signup에는 IP당 분당 10회 제한이 있어 요청마다 다른 문서용 주소(RFC 5737)를 쓴다.
    String nextAddress() { int n=ADDRESS.getAndIncrement(); return "203.0.113."+(n%250+1); }
    ResultActions withdraw(Cookie cookie, Object request) throws Exception {
        var builder=post("/api/auth/withdraw").with(r -> { r.setRemoteAddr(nextAddress()); return r; }).contentType("application/json").content(body(request));
        return mvc.perform(cookie==null ? builder : builder.cookie(cookie));
    }
    ResultActions withdraw(Cookie cookie, String password) throws Exception { return withdraw(cookie, Map.of("password",password,"confirm",true)); }
    Cookie session(User user) { return new Cookie(SharedSessionService.COOKIE, sessions.create(users.findById(user.getId()).orElseThrow())); }
    User create(String prefix, String email) {
        User user=new User(prefix+"-"+UUID.randomUUID().toString().substring(0,8),BCRYPT.encode("password-1"));
        if (email!=null) user.registerEmail(email);
        return users.saveAndFlush(user);
    }
    User reload(User user) { return users.findById(user.getId()).orElseThrow(); }
    int count(String sql, Object... args) { return jdbc.queryForObject(sql,Integer.class,args); }
    int image(long owner) { return jdbc.queryForObject("INSERT INTO community_images(owner_id,mime,data) VALUES(?,'image/png',?) RETURNING id",Integer.class,owner,new byte[]{1,2,3}); }
    int insertPost(long author, String title, boolean deleted, Integer... images) {
        return jdbc.queryForObject("INSERT INTO board_posts(title,content,author_id,image_ids,deleted,deleted_reason,deleted_at,deleted_by) VALUES(?,?,?,?::int[],?,?,?,?) RETURNING id",
            Integer.class,title,"본문 "+title,author,"{"+String.join(",",Arrays.stream(images).map(String::valueOf).toList())+"}",deleted,
            deleted?"AUTHOR":null,deleted?java.sql.Timestamp.from(Instant.now()):null,deleted?author:null);
    }
    int listing(long seller, String status, String contact, String region, Integer imageId) {
        return jdbc.queryForObject("""
            INSERT INTO parts_listings(seller_id,title,description,price,category,status,image_ids,vehicle,region,contact)
            VALUES(?,?,'설명',1000,'wheels',?,?::int[],'Avante',?,?) RETURNING id""",Integer.class,seller,status+" 매물",status,imageId==null?"{}":"{"+imageId+"}",region,contact);
    }
    Map<String,Object> userRow(User u) { return jdbc.queryForMap("SELECT username,email,kakao_id,nickname,account_status,withdrawn_at,auth_version,password FROM users WHERE id=?",u.getId()); }

    @Test void requestsWithoutSessionConfirmationOrCorrectPasswordChangeNothing() throws Exception {
        User user=create("w-guard","guard-"+UUID.randomUUID()+"@example.com"); Cookie c=session(user);
        Map<String,Object> before=userRow(user);
        withdraw(null,"password-1").andExpect(status().isUnauthorized());
        withdraw(c,Map.of("password","password-1")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CONFIRM_REQUIRED"));
        withdraw(c,Map.of("password","password-1","confirm",false)).andExpect(status().isBadRequest());
        withdraw(c,Map.of("confirm",true)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("PASSWORD_REQUIRED"));
        withdraw(c,"wrong-password").andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("WRONG_PASSWORD"));
        assertEquals(before,userRow(user));
        assertEquals(0,count("SELECT count(*)::int FROM withdrawal_blocks WHERE user_id=?",user.getId()));
        // 비밀번호 확인 실패는 회원당 5회/15분으로 막는다(맞는 비밀번호도 그동안은 429).
        for (int i=0;i<4;i++) withdraw(c,"wrong-password").andExpect(status().isForbidden());
        withdraw(c,"password-1").andExpect(status().isTooManyRequests());
        assertEquals(before,userRow(user));
        redis.delete(LoginAttemptLimiter.withdrawKey(user.getId()));
        mvc.perform(get("/api/auth/me").cookie(c)).andExpect(status().isOk());
    }

    @Test void withdrawalKeepsPublicContextAndRemovesPersonalData() throws Exception {
        String email="w-full-"+UUID.randomUUID()+"@Example.com";
        User w=create("w-full",email.toLowerCase(Locale.ROOT)), a=create("w-other",null);
        String oldName=w.getUsername(); long id=w.getId();
        // 사진: 공개 글, 작성자가 지운 글, 공개 글+프로필 공유, 커버 전용, 차량 전용, 미첨부, 판매중 매물, 판매완료 매물.
        int imgPost=image(id), imgDeleted=image(id), imgShared=image(id), imgCover=image(id), imgCar=image(id), imgOrphan=image(id), imgSelling=image(id), imgSold=image(id);
        int live=insertPost(id,"공개 글",false,imgPost,imgShared), removed=insertPost(id,"지운 글",true,imgDeleted), other=insertPost(a.getId(),"A의 글",false);
        int wComment=jdbc.queryForObject("INSERT INTO board_comments(post_id,author_id,content) VALUES(?,?,'W 댓글') RETURNING id",Integer.class,other,id);
        jdbc.update("INSERT INTO board_comments(post_id,author_id,content) VALUES(?,?,'A 댓글')",live,a.getId());
        jdbc.update("INSERT INTO board_likes(post_id,user_id) VALUES(?,?),(?,?)",other,id,live,a.getId());
        jdbc.update("INSERT INTO board_bookmarks(post_id,user_id) VALUES(?,?)",other,id);
        jdbc.update("INSERT INTO community_notifications(user_id,actor_id,post_id,kind) VALUES(?,?,?,'comment'),(?,?,?,'comment')",id,a.getId(),live,a.getId(),id,other);
        jdbc.update("INSERT INTO community_reports(user_id,post_id,reason) VALUES(?,?,'W의 신고'),(?,?,'W 글 신고')",id,other,a.getId(),live);
        jdbc.update("""
            INSERT INTO moderation_logs(action_type,category,post_id,post_title,target_id,target_author_id,target_author_username,original_content,reason,admin_id,admin_username)
            VALUES('COMMENT_DELETE','free',?,'t',?,?,?,'원문','사유',1,'admin')""",other,wComment,id,oldName);
        jdbc.update("INSERT INTO admin_member_actions(action,admin_id,created_at,user_id) VALUES('UPDATE:NICKNAME',1,NOW(),?)",id);
        jdbc.update("INSERT INTO garage_guestbook(owner_id,author_id,content) VALUES(?,?,'A가 W 차고에'),(?,?,'W가 A 차고에')",id,a.getId(),a.getId(),id);
        int car=jdbc.queryForObject("INSERT INTO owner_vehicles(owner_id,model,year,image_id,license_plate) VALUES(?,'Avante',2022,?,'12가3456') RETURNING id",Integer.class,id,imgCar);
        jdbc.update("INSERT INTO vehicle_records(vehicle_id,kind,title,recorded_on) VALUES(?,'maintenance','오일 교환',CURRENT_DATE)",car);
        jdbc.update("INSERT INTO vehicle_verifications(vehicle_id,document_mime,document_data) VALUES(?,'image/png',?)",car,new byte[]{9});
        jdbc.update("UPDATE board_posts SET vehicle_id=? WHERE id=?",car,live);
        jdbc.update("INSERT INTO member_profiles(user_id,bio,avatar_image_id,cover_image_id,representative_vehicle_id) VALUES(?,'소개',?,?,?)",id,imgShared,imgCover,car);
        int selling=listing(id,"selling","010-1111-2222","서울 강남구",imgSelling), sold=listing(id,"sold","010-3333-4444","서울 마포구",imgSold);
        int aListing=listing(a.getId(),"selling","010-5555","부산",null);
        jdbc.update("INSERT INTO parts_favorites(listing_id,user_id) VALUES(?,?),(?,?)",selling,a.getId(),aListing,id);
        // 탈퇴 전에 받아 둔 비밀번호 재설정 토큰.
        resets.request(oldName,email,"withdraw-test");
        ArgumentCaptor<String> code=ArgumentCaptor.forClass(String.class);
        verify(mail).send(eq(email.toLowerCase(Locale.ROOT)),code.capture());
        String resetToken=resets.verify(email,code.getValue(),"withdraw-test");
        Cookie current=session(w), otherDevice=session(w);
        String currentKey="revcc:session:"+current.getValue(), otherKey="revcc:session:"+otherDevice.getValue();

        // 탈퇴 화면 정보, 탈퇴.
        mvc.perform(get("/api/auth/withdraw").cookie(current)).andExpect(status().isOk())
            .andExpect(jsonPath("$.method").value("PASSWORD")).andExpect(jsonPath("$.reservedListings").value(0)).andExpect(jsonPath("$.available").value(true));
        Instant before=Instant.now();
        MvcResult done=withdraw(current,"password-1").andExpect(status().isOk()).andReturn();
        assertEquals(0,done.getResponse().getCookie(SharedSessionService.COOKIE).getMaxAge(),"session cookie is cleared");

        // 회원 행: 유지, WITHDRAWN, withdrawn_at, 직접 식별값 익명화, 세션 버전 증가.
        Map<String,Object> row=userRow(w);
        assertEquals("WITHDRAWN",row.get("account_status"));
        assertTrue(((java.sql.Timestamp)row.get("withdrawn_at")).toInstant().isAfter(before.minusSeconds(1)));
        assertEquals("withdrawn:"+id,row.get("username"));
        assertNull(row.get("email")); assertNull(row.get("kakao_id")); assertNull(row.get("nickname"));
        assertFalse(BCRYPT.matches("password-1",(String)row.get("password")));
        assertEquals(1L,((Number)row.get("auth_version")).longValue());
        // 세션: 현재 세션 키는 지워지고, 다른 기기 세션은 키가 남아 있어도 거부된다(Spring). board는 withdrawal-system.mjs에서 확인한다.
        assertFalse(Boolean.TRUE.equals(redis.hasKey(currentKey)));
        assertTrue(Boolean.TRUE.equals(redis.hasKey(otherKey)));
        mvc.perform(get("/api/auth/me").cookie(otherDevice)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").cookie(current)).andExpect(status().isUnauthorized());
        // 반복 탈퇴 요청은 401(이미 로그아웃 상태).
        withdraw(otherDevice,"password-1").andExpect(status().isUnauthorized());
        // 비밀번호 재설정: 탈퇴 전 토큰도 쓸 수 없고, 옛 아이디로 새로 요청할 수도 없다.
        String hashAfter=(String)userRow(w).get("password");
        assertThrows(ResponseStatusException.class,()->resets.reset(resetToken,"new-password-1","new-password-1"));
        assertEquals(hashAfter,userRow(w).get("password"));
        var notFound=assertThrows(PasswordResetService.RequestFailure.class,()->resets.request(oldName,"x-"+email,"withdraw-test-2"));
        assertEquals("USERNAME_NOT_FOUND",notFound.code());

        // 게시글·댓글·신고·운영 기록 유지.
        assertEquals(2,count("SELECT count(*)::int FROM board_posts WHERE author_id=?",id));
        assertFalse(jdbc.queryForObject("SELECT deleted FROM board_posts WHERE id=?",Boolean.class,live));
        assertNull(jdbc.queryForObject("SELECT vehicle_id FROM board_posts WHERE id=?",Integer.class,live));
        assertEquals(1,count("SELECT count(*)::int FROM board_comments WHERE author_id=?",id));
        assertEquals(1,count("SELECT count(*)::int FROM board_comments WHERE post_id=?",live));
        assertEquals(2,count("SELECT count(*)::int FROM community_reports WHERE user_id=? OR post_id=?",id,live));
        assertEquals("탈퇴한 회원#"+id,jdbc.queryForObject("SELECT target_author_username FROM moderation_logs WHERE target_author_id=?",String.class,id));
        assertEquals(List.of("SELF_WITHDRAW:ACTIVE","UPDATE:NICKNAME"),jdbc.queryForList("SELECT action FROM admin_member_actions WHERE user_id=? ORDER BY id DESC",String.class,id));
        assertNull(jdbc.queryForObject("SELECT admin_id FROM admin_member_actions WHERE user_id=? AND action LIKE 'SELF_WITHDRAW%'",Long.class,id));
        // 좋아요·북마크·찜·받은 알림 삭제. 타인이 W 글에 누른 좋아요, W가 유발한 A의 알림은 남는다.
        assertEquals(0,count("SELECT count(*)::int FROM board_likes WHERE user_id=?",id));
        assertEquals(1,count("SELECT count(*)::int FROM board_likes WHERE post_id=?",live));
        assertEquals(0,count("SELECT count(*)::int FROM board_bookmarks WHERE user_id=?",id));
        assertEquals(0,count("SELECT count(*)::int FROM parts_favorites WHERE user_id=?",id));
        assertEquals(0,count("SELECT count(*)::int FROM community_notifications WHERE user_id=?",id));
        assertEquals(1,count("SELECT count(*)::int FROM community_notifications WHERE actor_id=?",id));
        // 차고: 차량·정비기록·자동차등록증·프로필·내 차고 방명록 삭제, 타인 차고에 쓴 방명록 유지.
        assertEquals(0,count("SELECT count(*)::int FROM owner_vehicles WHERE owner_id=?",id));
        assertEquals(0,count("SELECT count(*)::int FROM vehicle_records WHERE vehicle_id=?",car));
        assertEquals(0,count("SELECT count(*)::int FROM vehicle_verifications WHERE vehicle_id=?",car));
        assertEquals(0,count("SELECT count(*)::int FROM member_profiles WHERE user_id=?",id));
        assertEquals(0,count("SELECT count(*)::int FROM garage_guestbook WHERE owner_id=?",id));
        assertEquals(List.of("W가 A 차고에"),jdbc.queryForList("SELECT content FROM garage_guestbook WHERE author_id=?",String.class,id));
        // 사진: 게시글(삭제 글 포함)·남는 매물이 쓰는 것만 남는다. 프로필과 공유한 사진은 게시글 때문에 남는다.
        assertEquals(Set.of(imgPost,imgDeleted,imgShared,imgSelling,imgSold),
            new HashSet<>(jdbc.queryForList("SELECT id FROM community_images WHERE owner_id=?",Integer.class,id)));
        // 매물: 판매중 → closed(연락처·찜 삭제), 판매완료 → 유지(연락처만 삭제, 지역·사진 유지).
        Map<String,Object> closed=jdbc.queryForMap("SELECT status,contact,closed_at,image_ids::text AS images FROM parts_listings WHERE id=?",selling);
        assertEquals("closed",closed.get("status")); assertEquals("",closed.get("contact")); assertNotNull(closed.get("closed_at"));
        assertEquals(0,count("SELECT count(*)::int FROM parts_favorites WHERE listing_id=?",selling));
        Map<String,Object> kept=jdbc.queryForMap("SELECT status,contact,region,image_ids::text AS images,closed_at FROM parts_listings WHERE id=?",sold);
        assertEquals(Arrays.asList("sold","","서울 마포구","{"+imgSold+"}",null),Arrays.asList(kept.get("status"),kept.get("contact"),kept.get("region"),kept.get("images"),kept.get("closed_at")));
        assertEquals("010-5555",jdbc.queryForObject("SELECT contact FROM parts_listings WHERE id=?",String.class,aListing));

        // 재가입 제한: 아이디·이메일 COOLDOWN 30일, 원문 미저장.
        List<Map<String,Object>> rows=jdbc.queryForList("SELECT identifier_type,identifier_hmac,reason,expires_at FROM withdrawal_blocks WHERE user_id=? ORDER BY identifier_type",id);
        assertEquals(List.of("EMAIL","USERNAME"),rows.stream().map(r->r.get("identifier_type")).toList());
        for (Map<String,Object> r : rows) {
            assertEquals("COOLDOWN",r.get("reason"));
            Instant expires=((java.sql.Timestamp)r.get("expires_at")).toInstant();
            assertTrue(Math.abs(Duration.between(before.plus(Duration.ofDays(30)),expires).toSeconds())<60,"expires in 30 days");
            assertTrue(((String)r.get("identifier_hmac")).matches("[0-9a-f]{64}"));
        }
        String everything=jdbc.queryForObject("SELECT string_agg(row_to_json(w)::text,'') FROM withdrawal_blocks w",String.class);
        assertFalse(everything.contains(email.toLowerCase(Locale.ROOT))); assertFalse(everything.contains(oldName));
        // 단순 SHA-256(원문)이 아니다(키 없이 사전 대입으로 되돌릴 수 없다).
        String plainSha=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(("email:"+email.toLowerCase(Locale.ROOT)).getBytes()));
        assertFalse(everything.contains(plainSha));
        for (String table : List.of("users","admin_member_actions","moderation_logs","parts_listings","withdrawal_blocks"))
            assertEquals(0,count("SELECT count(*)::int FROM "+table+" t WHERE row_to_json(t)::text ILIKE ?","%"+email.toLowerCase(Locale.ROOT)+"%"),table+" keeps the raw email");
        // 같은 아이디·이메일로 가입 불가(아이디는 이미 있는 아이디와 같은 응답), 아이디 확인도 사용 불가, 관리자 이메일 등록도 불가.
        mvc.perform(post("/api/auth/signup").with(r->{r.setRemoteAddr(nextAddress());return r;}).contentType("application/json")
            .content(body(Map.of("username",oldName,"password","password-2")))).andExpect(status().isConflict());
        mvc.perform(post("/api/auth/signup").with(r->{r.setRemoteAddr(nextAddress());return r;}).contentType("application/json")
            .content(body(Map.of("username","fresh-"+UUID.randomUUID().toString().substring(0,8),"password","password-2","email",email.toUpperCase(Locale.ROOT)))))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.message").value(WithdrawalBlocks.MESSAGE));
        mvc.perform(get("/api/auth/check-username").with(r->{r.setRemoteAddr(nextAddress());return r;}).param("username",oldName))
            .andExpect(jsonPath("$.available").value(false));
        // 대소문자가 다른 아이디는 가입과 같은 규칙(대소문자 구분)이라 다른 아이디다.
        mvc.perform(get("/api/auth/check-username").with(r->{r.setRemoteAddr(nextAddress());return r;}).param("username",oldName.toUpperCase(Locale.ROOT)))
            .andExpect(jsonPath("$.available").value(true));
        assertTrue(blocks.blocked(WithdrawalBlocks.Type.EMAIL,email.toLowerCase(Locale.ROOT)));
        // 30일이 지나면 풀린다.
        jdbc.update("UPDATE withdrawal_blocks SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=?",id);
        assertFalse(blocks.blocked(WithdrawalBlocks.Type.EMAIL,email.toLowerCase(Locale.ROOT)));
        assertFalse(blocks.blocked(WithdrawalBlocks.Type.USERNAME,oldName));
    }

    @Test void reservedListingRefusesWithoutChangingAnything() throws Exception {
        User w=create("w-reserved","reserved-"+UUID.randomUUID()+"@example.com"); long id=w.getId(); Cookie c=session(w);
        int img=image(id), car=jdbc.queryForObject("INSERT INTO owner_vehicles(owner_id,model,year) VALUES(?,'K5',2021) RETURNING id",Integer.class,id);
        int reserved=listing(id,"reserved","010-9","대전",null), selling=listing(id,"selling","010-8","대전",img);
        Map<String,Object> before=userRow(w);
        mvc.perform(get("/api/auth/withdraw").cookie(c)).andExpect(jsonPath("$.reservedListings").value(1));
        MvcResult refused=withdraw(c,"password-1").andExpect(status().isConflict()).andReturn();
        assertEquals("RESERVED_LISTINGS",json(refused).get("code").asText());
        assertEquals(1,json(refused).get("reservedListings").asInt());
        assertTrue(json(refused).get("message").asText().contains("예약중"));
        assertEquals(before,userRow(w));
        assertEquals(List.of("reserved","selling"),jdbc.queryForList("SELECT status FROM parts_listings WHERE seller_id=? ORDER BY id",String.class,id));
        assertEquals("010-8",jdbc.queryForObject("SELECT contact FROM parts_listings WHERE id=?",String.class,selling));
        assertEquals(1,count("SELECT count(*)::int FROM owner_vehicles WHERE id=?",car));
        assertEquals(1,count("SELECT count(*)::int FROM community_images WHERE id=?",img));
        assertEquals(0,count("SELECT count(*)::int FROM withdrawal_blocks WHERE user_id=?",id));
        mvc.perform(get("/api/auth/me").cookie(c)).andExpect(status().isOk());
        assertEquals("reserved",jdbc.queryForObject("SELECT status FROM parts_listings WHERE id=?",String.class,reserved));
    }

    @Test void kakaoAndAdminAccountsAreRefused() throws Exception {
        long kakaoId=ThreadLocalRandom.current().nextLong(1_000_000_000L,9_000_000_000L);
        User k=users.saveAndFlush(new User("kakao-"+kakaoId,BCRYPT.encode("password-1"),kakaoId));
        Cookie ck=session(k); Map<String,Object> before=userRow(k);
        mvc.perform(get("/api/auth/withdraw").cookie(ck)).andExpect(jsonPath("$.method").value("KAKAO"));
        // 카카오 계정은 비밀번호를 알아도(무작위 값이라 알 수 없다) 세션만으로 탈퇴할 수 없다. 재인증은 STEP 10-impl-D.
        withdraw(ck,"password-1").andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("KAKAO_REAUTH_REQUIRED"));
        withdraw(ck,Map.of("confirm",true)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("KAKAO_REAUTH_REQUIRED"));
        assertEquals(before,userRow(k));
        assertEquals(0,count("SELECT count(*)::int FROM withdrawal_blocks WHERE user_id=?",k.getId()));
        User admin=create("w-admin",null); admin.manage(null,null,"ACTIVE","ADMIN",null); users.saveAndFlush(admin);
        withdraw(session(admin),"password-1").andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ADMIN_ROLE"));
        assertEquals("ACTIVE",reload(admin).getAccountStatus());
    }

    @Test void sanctionedWithdrawalBlocksForTheLaterOfThirtyDaysAndTheSanction() {
        // 정지·비활성화 계정은 로그인할 수 없어 API로는 탈퇴할 수 없다(인증 단계에서 거부). 세션 확인 뒤 잠금 사이에 제재된
        // 경우처럼 서비스가 제재 상태의 회원을 처리하면 SANCTION을 함께 기록하는지 확인한다.
        Instant now=Instant.now();
        record Case(String status, Instant until, Instant expected, boolean indefinite) {}
        for (Case k : List.of(new Case("SUSPENDED",now.plus(Duration.ofDays(90)),now.plus(Duration.ofDays(90)),false),
                              new Case("SUSPENDED",now.plus(Duration.ofDays(3)),now.plus(Duration.ofDays(30)),false),
                              new Case("SUSPENDED",null,null,true),
                              new Case("DISABLED",null,null,true))) {
            User u=create("w-sanction","sanction-"+UUID.randomUUID()+"@example.com");
            u.manage(null,u.getEmail(),k.status(),"USER",k.until()); users.saveAndFlush(u);
            withdrawals.withdraw(u.getId(),reload(u).getAuthVersion(),"password-1",stored->true,()->{});
            List<Map<String,Object>> sanction=jdbc.queryForList("SELECT identifier_type,expires_at FROM withdrawal_blocks WHERE user_id=? AND reason='SANCTION' ORDER BY identifier_type",u.getId());
            assertEquals(List.of("EMAIL","USERNAME"),sanction.stream().map(r->r.get("identifier_type")).toList(),k.toString());
            for (Map<String,Object> r : sanction) {
                if (k.indefinite()) assertNull(r.get("expires_at"),k.toString());
                else assertTrue(Math.abs(Duration.between(k.expected(),((java.sql.Timestamp)r.get("expires_at")).toInstant()).toSeconds())<60,k.toString());
            }
            assertEquals(2,count("SELECT count(*)::int FROM withdrawal_blocks WHERE user_id=? AND reason='COOLDOWN'",u.getId()));
            assertEquals("SELF_WITHDRAW:"+k.status(),jdbc.queryForObject("SELECT action FROM admin_member_actions WHERE user_id=? ORDER BY id DESC LIMIT 1",String.class,u.getId()));
            // 제재 기록(정지 종료일)은 회원 행에 남는다.
            assertEquals(k.until()==null?null:k.until().truncatedTo(java.time.temporal.ChronoUnit.MILLIS),reload(u).getSuspendedUntil()==null?null:reload(u).getSuspendedUntil().truncatedTo(java.time.temporal.ChronoUnit.MILLIS));
        }
    }

    @Test void failureInTheMiddleRollsBackEverything() throws Exception {
        User w=create("w-rollback","rollback-"+UUID.randomUUID()+"@example.com"); long id=w.getId(); Cookie c=session(w);
        int img=image(id); jdbc.update("INSERT INTO owner_vehicles(owner_id,model,year,image_id) VALUES(?,'Ray',2019,?)",id,img);
        int selling=listing(id,"selling","010-7","광주",null); int p=insertPost(id,"글",false);
        jdbc.update("INSERT INTO board_likes(post_id,user_id) VALUES(?,?)",p,id);
        Map<String,Object> before=userRow(w);
        // 마지막 단계(관리자 기록 저장)에서 실패시킨다. 그 앞의 삭제·익명화·재가입 제한이 모두 롤백돼야 한다.
        jdbc.execute("CREATE OR REPLACE FUNCTION fail_withdraw_test() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$ LANGUAGE plpgsql");
        jdbc.execute("CREATE TRIGGER fail_withdraw_test BEFORE INSERT ON admin_member_actions FOR EACH ROW WHEN (NEW.user_id="+id+") EXECUTE FUNCTION fail_withdraw_test()");
        try {
            assertThrows(Exception.class,()->withdraw(c,"password-1"));
        } finally {
            jdbc.execute("DROP TRIGGER fail_withdraw_test ON admin_member_actions");
            jdbc.execute("DROP FUNCTION fail_withdraw_test()");
        }
        assertEquals(before,userRow(w));
        assertEquals(1,count("SELECT count(*)::int FROM owner_vehicles WHERE owner_id=?",id));
        assertEquals(1,count("SELECT count(*)::int FROM community_images WHERE id=?",img));
        assertEquals("selling",jdbc.queryForObject("SELECT status FROM parts_listings WHERE id=?",String.class,selling));
        assertEquals(1,count("SELECT count(*)::int FROM board_likes WHERE user_id=?",id));
        assertEquals(0,count("SELECT count(*)::int FROM withdrawal_blocks WHERE user_id=?",id));
        mvc.perform(get("/api/auth/me").cookie(c)).andExpect(status().isOk());
        // 실패 뒤 다시 시도하면 정상 탈퇴된다.
        withdraw(c,"password-1").andExpect(status().isOk());
        assertEquals("WITHDRAWN",reload(w).getAccountStatus());
    }

    @Test void concurrentWithdrawalsOfOneAccountSucceedOnce() throws Exception {
        for (int round=0; round<4; round++) {
            User w=create("w-race","race-"+UUID.randomUUID()+"@example.com"); Cookie c1=session(w), c2=session(w);
            CyclicBarrier start=new CyclicBarrier(2);
            List<Integer> statuses=new ArrayList<>();
            try (ExecutorService pool=Executors.newFixedThreadPool(2)) {
                for (Future<Integer> f : pool.invokeAll(List.<Callable<Integer>>of(
                        ()->{ start.await(); return withdraw(c1,"password-1").andReturn().getResponse().getStatus(); },
                        ()->{ start.await(); return withdraw(c2,"password-1").andReturn().getResponse().getStatus(); })))
                    statuses.add(f.get());
            }
            assertEquals(List.of(200,401),statuses.stream().sorted().toList(),"round "+round);
            assertEquals(2,count("SELECT count(*)::int FROM withdrawal_blocks WHERE user_id=?",w.getId()));
            assertEquals(1,count("SELECT count(*)::int FROM admin_member_actions WHERE user_id=? AND action LIKE 'SELF_WITHDRAW%'",w.getId()));
        }
    }

    @Test void reservedStatusChangeRacingAWithdrawalNeverLeavesAReservedListing() throws Exception {
        // 판매중 → 예약중 변경(board PATCH와 같은 UPDATE)과 탈퇴가 동시에 오면, 탈퇴가 매물을 잠그므로 둘 중 하나만 이긴다:
        // 탈퇴가 먼저면 매물은 closed(board의 UPDATE는 status<>'closed' 조건으로 0행), 변경이 먼저면 탈퇴가 409.
        for (int round=0; round<6; round++) {
            User w=create("w-race-listing",null); Cookie c=session(w);
            int selling=listing(w.getId(),"selling","010","울산",null);
            CyclicBarrier start=new CyclicBarrier(2);
            try (ExecutorService pool=Executors.newFixedThreadPool(2)) {
                Future<Integer> withdrawal=pool.submit(()->{ start.await(); return withdraw(c,"password-1").andReturn().getResponse().getStatus(); });
                Future<Integer> reserve=pool.submit(()->{ start.await();
                    return jdbc.update("UPDATE parts_listings SET status='reserved',updated_at=NOW() WHERE id=? AND seller_id=? AND status<>'closed'",selling,w.getId()); });
                int status=withdrawal.get(), changed=reserve.get();
                String now=jdbc.queryForObject("SELECT status FROM parts_listings WHERE id=?",String.class,selling);
                if (status==200) { assertEquals("closed",now,"round "+round); assertEquals(0,changed); }
                else { assertEquals(409,status,"round "+round); assertEquals("reserved",now); assertEquals("ACTIVE",reload(w).getAccountStatus()); }
            }
        }
    }

    @Test void withdrawnAccountStaysUnrecoverableAndLastAdminIsStillProtected() throws Exception {
        jdbc.update("UPDATE users SET role='USER' WHERE role='ADMIN'");
        User admin=create("w-lastadmin",null); admin.manage(null,null,"ACTIVE","ADMIN",null); users.saveAndFlush(admin);
        Cookie ca=session(admin);
        User w=create("w-restore",null); withdraw(session(w),"password-1").andExpect(status().isOk());
        for (Map<String,Object> change : List.of(Map.<String,Object>of("status","ACTIVE","role","USER"),Map.<String,Object>of("status","WITHDRAWN","role","USER")))
            mvc.perform(patch("/api/admin/members/"+w.getId()).cookie(ca).contentType("application/json").content(body(change)))
                .andExpect(status().is4xxClientError());
        assertEquals("WITHDRAWN",reload(w).getAccountStatus());
        // 관리자 기록 화면: 본인 탈퇴(관리자 없음) 기록도 조회된다.
        mvc.perform(get("/api/admin/members/"+w.getId()+"/actions").cookie(ca)).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].action").value("SELF_WITHDRAW:ACTIVE")).andExpect(jsonPath("$[0].adminId").value(org.hamcrest.Matchers.nullValue()));
        mvc.perform(patch("/api/admin/members/"+admin.getId()).cookie(ca).contentType("application/json").content(body(Map.of("status","ACTIVE","role","USER"))))
            .andExpect(status().isConflict());
        // 탈퇴 회원 이메일을 다른 회원에게 등록할 수 없다.
        User v=create("w-email","reg-"+UUID.randomUUID()+"@example.com"); String mailAddress=v.getEmail();
        withdraw(session(v),"password-1").andExpect(status().isOk());
        User x=create("w-admin-target",null);
        mvc.perform(patch("/api/admin/members/"+x.getId()).cookie(ca).contentType("application/json")
            .content(body(Map.of("status","ACTIVE","role","USER","email",mailAddress)))).andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value(WithdrawalBlocks.MESSAGE));
    }
}
