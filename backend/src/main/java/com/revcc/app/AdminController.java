package com.revcc.app;

import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** 관리자 전용 API. 화면에서 메뉴를 숨기는 것과 별개로 role을 서버에서 다시 검증한다. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final SharedSessionService sessions;
    private final UserRepository users;
    private final GarageVehicleRepository vehicles;
    private final VehicleVerificationRepository verifications;

    public AdminController(SharedSessionService sessions, UserRepository users, GarageVehicleRepository vehicles,
            VehicleVerificationRepository verifications) {
        this.sessions = sessions;
        this.users = users;
        this.vehicles = vehicles;
        this.verifications = verifications;
    }

    // 관리자 화면 나머지 섹션(회원/게시글/신고/인장·태그 관리)은 Mock UI이며
    // 이 엔드포인트와 차량 인증 관리만 실제 값을 반환해 접근 제어가 프론트엔드가 아닌 서버에서 이뤄짐을 보장한다.
    @GetMapping("/overview")
    public Map<String, Object> overview(
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token) {
        requireAdmin(token);
        return Map.of("totalUsers", users.count(), "totalVehicles", vehicles.count());
    }

    public record VerificationSummary(Integer id, Integer vehicleId, String username, String licensePlate,
        String manufacturer, String model, Integer modelYear, String status, Instant requestedAt) {
        static VerificationSummary from(VehicleVerification v) {
            Vehicle vehicle = v.getVehicle();
            return new VerificationSummary(v.getId(), vehicle.getId(), vehicle.getUser().getUsername(),
                vehicle.getLicensePlate(), vehicle.getManufacturer(), vehicle.getModel(), vehicle.getModelYear(),
                v.getStatus(), v.getRequestedAt());
        }
    }

    @GetMapping("/vehicle-verifications")
    public List<VerificationSummary> verifications(
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token) {
        requireAdmin(token);
        return verifications.findAllByOrderByIdDesc().stream().map(VerificationSummary::from).toList();
    }

    @Transactional
    @PostMapping("/vehicle-verifications/{id}/approve")
    public VerificationSummary approve(@PathVariable Integer id,
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token) {
        User admin = requireAdmin(token);
        VehicleVerification verification = findVerification(id);
        verification.approve(admin);
        verification.getVehicle().approveVerification(Instant.now());
        vehicles.saveAndFlush(verification.getVehicle());
        return VerificationSummary.from(verifications.saveAndFlush(verification));
    }

    @Transactional
    @PostMapping("/vehicle-verifications/{id}/reject")
    public VerificationSummary reject(@PathVariable Integer id,
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token) {
        User admin = requireAdmin(token);
        VehicleVerification verification = findVerification(id);
        verification.reject(admin);
        verification.getVehicle().rejectVerification();
        vehicles.saveAndFlush(verification.getVehicle());
        return VerificationSummary.from(verifications.saveAndFlush(verification));
    }

    private VehicleVerification findVerification(Integer id) {
        return verifications.findById(id).orElseThrow(() ->
            new ResponseStatusException(HttpStatus.NOT_FOUND, "인증 신청을 찾을 수 없습니다."));
    }

    private User requireAdmin(String token) {
        SharedSessionService.SessionUser session = sessions.require(token);
        if (!"ADMIN".equals(session.role()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "관리자만 접근할 수 있습니다.");
        return users.findById(session.id()).orElseThrow(() ->
            new ResponseStatusException(HttpStatus.UNAUTHORIZED, "다시 로그인해주세요."));
    }
}
