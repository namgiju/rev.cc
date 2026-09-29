package com.revcc.app;

import jakarta.persistence.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.*;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@Entity
@Table(name="admin_member_actions")
class AdminMemberAction {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
    Long adminId;
    Long userId;
    String action;
    Instant createdAt;
    protected AdminMemberAction() {}
    AdminMemberAction(Long admin, Long user, String action) {
        adminId=admin; userId=user; this.action=action; createdAt=Instant.now();
    }
}
interface AdminMemberActionRepository extends JpaRepository<AdminMemberAction,Long> {
    Page<AdminMemberAction> findByUserIdOrderByIdDesc(Long userId, Pageable pageable);
}

@RestController
@RequestMapping("/api/admin/members")
public class AdminMemberController {
    private final UserRepository users;
    private final SharedSessionService sessions;
    private final PasswordResetService resets;
    private final AdminMemberActionRepository logs;
    public AdminMemberController(UserRepository users, SharedSessionService sessions, PasswordResetService resets, AdminMemberActionRepository logs) {
        this.users=users; this.sessions=sessions; this.resets=resets; this.logs=logs;
    }
    private User admin(String token) {
        var session=sessions.require(token);
        User user=users.findById(session.id()).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
        if (!"ADMIN".equals(session.role()) || !"ADMIN".equals(user.getRole()) || user.isBlocked())
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "관리자만 접근할 수 있습니다.");
        return user;
    }
    private User user(Long id) { return users.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND)); }
    public record Member(Long id, String username, String nickname, String email, Instant joinedAt, String status, String role, Instant suspendedUntil, boolean kakaoOnly) {
        static Member from(User u) { return new Member(u.getId(),u.getUsername(),u.getNickname(),u.getEmail(),u.getCreatedAt(),u.getAccountStatus(),u.getRole(),u.getSuspendedUntil(),u.getKakaoId()!=null); }
    }
    @GetMapping public Map<String,Object> list(@CookieValue(name=SharedSessionService.COOKIE,required=false) String token,
            @RequestParam(defaultValue="") String q, @RequestParam(defaultValue="username") String field,
            @RequestParam(defaultValue="") String status, @RequestParam(defaultValue="1") int page) {
        admin(token);
        if (page<1 || page>100000 || q.length()>100 || !Set.of("username","nickname","email").contains(field) ||
            !Set.of("","ACTIVE","SUSPENDED","DISABLED").contains(status)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        String pattern="%"+q.trim().toLowerCase(Locale.ROOT).replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%";
        Page<User> result=users.findAll((root,query,cb)-> {
            var search=q.isBlank() ? cb.conjunction() : cb.like(cb.lower(root.get(field)),pattern,'\\');
            return status.isEmpty() ? search : cb.and(search,cb.equal(cb.coalesce(root.get("accountStatus"),"ACTIVE"),status));
        }, PageRequest.of(page-1,20,Sort.by(Sort.Direction.DESC,"id")));
        return Map.of("items",result.map(Member::from).getContent(),"total",result.getTotalElements(),"page",page,"pageSize",20);
    }
    @GetMapping("/{id}") public Member detail(@PathVariable Long id, @CookieValue(name=SharedSessionService.COOKIE,required=false) String token) {
        admin(token); return Member.from(user(id));
    }
    public record Update(@Size(max=100) String nickname, @Email @Size(max=254) String email,
        @NotNull @Pattern(regexp="ACTIVE|SUSPENDED|DISABLED") String status,
        @NotNull @Pattern(regexp="USER|ADMIN") String role, Instant suspendedUntil) {}
    @Transactional
    @PatchMapping("/{id}") public Member update(@PathVariable Long id, @Valid @RequestBody Update body,
            @CookieValue(name=SharedSessionService.COOKIE,required=false) String token) {
        User actor=admin(token);
        User target=users.lockById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (actor.getId().equals(id) && (!"ADMIN".equals(body.role()) || !"ACTIVE".equals(body.status())))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"자신의 관리자 권한 또는 이용 상태는 변경할 수 없습니다.");
        if (body.suspendedUntil()!=null && (!"SUSPENDED".equals(body.status()) || !body.suspendedUntil().isAfter(Instant.now())))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"정지 종료일은 미래 시각으로 입력해주세요.");
        String email=body.email()==null || body.email().isBlank() ? null : PasswordResetService.email(body.email());
        if (email!=null && users.findByEmail(email).filter(u -> !u.getId().equals(id)).isPresent())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"이미 등록된 이메일입니다.");
        List<String> changes=new ArrayList<>();
        if (!Objects.equals(target.getNickname(),body.nickname())) changes.add("NICKNAME");
        if (!Objects.equals(target.getEmail(),email)) changes.add("EMAIL");
        if (!target.getRole().equals(body.role())) changes.add("ROLE");
        if (!target.getAccountStatus().equals(body.status()) || !Objects.equals(target.getSuspendedUntil(),body.suspendedUntil())) changes.add("STATUS");
        if (!changes.isEmpty()) {
            target.manage(body.nickname(),email,body.status(),body.role(),body.suspendedUntil());
            users.saveAndFlush(target);
            logs.save(new AdminMemberAction(actor.getId(),id,"UPDATE:"+String.join(",",changes)));
        }
        return Member.from(target);
    }
    @PostMapping("/{id}/password-reset") public Map<String,String> reset(@PathVariable Long id,
            @CookieValue(name=SharedSessionService.COOKIE,required=false) String token) {
        User actor=admin(token), target=user(id);
        if (target.getEmail()==null || target.getKakaoId()!=null) throw new ResponseStatusException(HttpStatus.CONFLICT,"이메일이 등록된 일반 계정만 재설정할 수 있습니다.");
        resets.request(target.getUsername(),target.getEmail(),"admin:"+actor.getId());
        logs.save(new AdminMemberAction(actor.getId(),id,"PASSWORD_RESET_REQUEST"));
        return PasswordResetController.message();
    }
    @GetMapping("/{id}/actions") public List<Map<String,Object>> actions(@PathVariable Long id,
            @CookieValue(name=SharedSessionService.COOKIE,required=false) String token) {
        admin(token); user(id);
        return logs.findByUserIdOrderByIdDesc(id,PageRequest.of(0,50)).map(l -> Map.<String,Object>of(
            "adminId",l.adminId,"action",l.action,"createdAt",l.createdAt)).getContent();
    }
    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    @ResponseStatus(HttpStatus.CONFLICT) public Map<String,String> conflict() { return Map.of("message","이미 등록된 이메일이거나 다른 변경과 충돌했습니다."); }
}
