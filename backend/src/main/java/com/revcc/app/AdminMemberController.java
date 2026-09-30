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
    private final WithdrawalBlocks blocks;
    @PersistenceContext private EntityManager entityManager;
    public AdminMemberController(UserRepository users, SharedSessionService sessions, PasswordResetService resets, AdminMemberActionRepository logs,
            WithdrawalBlocks blocks) {
        this.users=users; this.sessions=sessions; this.resets=resets; this.logs=logs; this.blocks=blocks;
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
            !Set.of("","ACTIVE","SUSPENDED","DISABLED",User.WITHDRAWN).contains(status)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        String pattern="%"+q.trim().toLowerCase(Locale.ROOT).replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%";
        Page<User> result=users.findAll((root,query,cb)-> {
            var search=q.isBlank() ? cb.conjunction() : cb.like(cb.lower(root.get(field)),pattern,'\\');
            var current=cb.coalesce(root.get("accountStatus"),"ACTIVE");
            // 기본 목록에는 탈퇴 계정을 넣지 않는다. 상태 필터 WITHDRAWN으로만 조회한다.
            return status.isEmpty() ? cb.and(search,cb.notEqual(current,User.WITHDRAWN)) : cb.and(search,cb.equal(current,status));
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
        // 관리자 행을 모두(id 순서로) 잠근 뒤 최신 상태로 판단한다. 두 관리자가 동시에 서로를 강등해도
        // 뒤에 온 요청은 앞 요청이 커밋된 결과를 보고 판단하므로 관리자가 0명이 되지 않는다.
        users.lockAdmins();
        Instant now=Instant.now();
        // 잠금을 기다리는 사이 요청한 관리자 자신이 강등·정지됐을 수 있으므로 다시 확인한다.
        if (!users.isEffectiveAdmin(actor.getId(),now))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "관리자만 접근할 수 있습니다.");
        User target=users.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        // 요청 초반에 읽어 둔 엔티티(자기 자신 수정 등)가 오래된 값이면 그 값으로 덮어쓰지 않도록 잠그며 다시 읽는다.
        entityManager.refresh(target, LockModeType.PESSIMISTIC_WRITE);
        // 탈퇴는 되돌릴 수 없는 최종 상태다. 상태·권한·연락처 등 어떤 변경도 받지 않는다.
        if (target.isWithdrawn())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"탈퇴한 회원의 정보는 변경할 수 없습니다.");
        if (actor.getId().equals(id) && (!"ADMIN".equals(body.role()) || !"ACTIVE".equals(body.status())))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"자신의 관리자 권한 또는 이용 상태는 변경할 수 없습니다.");
        // 변경 후에 관리자 기능을 쓸 수 있는 관리자가 한 명도 남지 않으면 거부한다(강등·정지·비활성화 모두).
        // 정지는 종료일이 미래일 때만 허용되므로(아래 검사) 변경 후 유효한 관리자는 ADMIN + ACTIVE뿐이다.
        boolean remainsAdmin="ADMIN".equals(body.role()) && "ACTIVE".equals(body.status());
        if (target.isEffectiveAdmin() && !remainsAdmin && users.countEffectiveAdminsExcept(id,now)==0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"마지막 관리자는 강등하거나 이용을 제한할 수 없습니다. 다른 관리자를 먼저 지정해주세요.");
        if (body.suspendedUntil()!=null && (!"SUSPENDED".equals(body.status()) || !body.suspendedUntil().isAfter(Instant.now())))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"정지 종료일은 미래 시각으로 입력해주세요.");
        String email=body.email()==null || body.email().isBlank() ? null : PasswordResetService.email(body.email());
        if (email!=null && users.findByEmail(email).filter(u -> !u.getId().equals(id)).isPresent())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"이미 등록된 이메일입니다.");
        // 탈퇴 회원의 이메일은 재가입 제한 기간 동안 다른 계정에 새로 등록할 수 없다(가입과 같은 규칙).
        if (email!=null && !email.equals(target.getEmail()) && blocks.blocked(WithdrawalBlocks.Type.EMAIL,email))
            throw new ResponseStatusException(HttpStatus.CONFLICT,WithdrawalBlocks.MESSAGE);
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
        if (target.isWithdrawn()) throw new ResponseStatusException(HttpStatus.CONFLICT,"탈퇴한 회원입니다.");
        if (target.getEmail()==null || target.getKakaoId()!=null) throw new ResponseStatusException(HttpStatus.CONFLICT,"이메일이 등록된 일반 계정만 재설정할 수 있습니다.");
        resets.request(target.getUsername(),target.getEmail(),"admin:"+actor.getId());
        logs.save(new AdminMemberAction(actor.getId(),id,"PASSWORD_RESET_REQUEST"));
        return PasswordResetController.message();
    }
    @GetMapping("/{id}/actions") public List<Map<String,Object>> actions(@PathVariable Long id,
            @CookieValue(name=SharedSessionService.COOKIE,required=false) String token) {
        admin(token); user(id);
        // 본인 탈퇴 기록(SELF_WITHDRAW)은 관리자 없이 남으므로 adminId가 null일 수 있다(Map.of는 null을 받지 않는다).
        return logs.findByUserIdOrderByIdDesc(id,PageRequest.of(0,50)).map(l -> {
            Map<String,Object> row=new LinkedHashMap<>();
            row.put("adminId",l.adminId); row.put("action",l.action); row.put("createdAt",l.createdAt);
            return row;
        }).getContent();
    }
    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    @ResponseStatus(HttpStatus.CONFLICT) public Map<String,String> conflict() { return Map.of("message","이미 등록된 이메일이거나 다른 변경과 충돌했습니다."); }
}
