package com.revcc.app;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 자동차등록증 업로드/조회. board-service의 공개 이미지(community_images)와는
 * 별도 테이블(vehicle_verifications)에 저장하고, 소유자 본인과 관리자만 열람할 수 있다. */
@RestController
public class VehicleVerificationController {
    // 게시글 사진 업로드(js/app.js uploadFile)와 동일한 형식·용량 제한(최대 3MB)을 그대로 따른다.
    private static final Pattern DATA_URL =
        Pattern.compile("^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$");

    private final GarageVehicleRepository vehicles;
    private final VehicleVerificationRepository verifications;
    private final SharedSessionService sessions;

    public VehicleVerificationController(GarageVehicleRepository vehicles,
            VehicleVerificationRepository verifications, SharedSessionService sessions) {
        this.vehicles = vehicles;
        this.verifications = verifications;
        this.sessions = sessions;
    }

    public record DocumentUpload(String data) {}

    @PostMapping("/api/garage/vehicles/{vehicleId}/verification")
    @Transactional
    public GarageVehicleResponse submit(@PathVariable Integer vehicleId,
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token,
            @RequestBody DocumentUpload upload) {
        Long userId = sessions.require(token).id();
        Vehicle vehicle = vehicles.findById(vehicleId).orElseThrow(() ->
            new ResponseStatusException(HttpStatus.NOT_FOUND, "차량을 찾을 수 없습니다."));
        if (!vehicle.getUser().getId().equals(userId))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "본인 차량만 인증을 신청할 수 있습니다.");
        if ("PENDING".equals(vehicle.getVerificationStatus()))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 검토 중인 인증 신청이 있습니다.");
        if (vehicle.isVerified())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 오너 인증이 완료된 차량입니다.");

        DecodedImage image = decode(upload.data());
        verifications.saveAndFlush(new VehicleVerification(vehicle, image.mime(), image.data()));
        vehicle.markVerificationPending();
        return GarageVehicleResponse.from(vehicles.saveAndFlush(vehicle));
    }

    // 소유자 본인 또는 관리자만 원본 등록증 이미지를 열람할 수 있다.
    @GetMapping("/api/garage/vehicle-verifications/{id}/document")
    public ResponseEntity<byte[]> document(@PathVariable Integer id,
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token) {
        SharedSessionService.SessionUser session = sessions.require(token);
        VehicleVerification verification = verifications.findById(id).orElseThrow(() ->
            new ResponseStatusException(HttpStatus.NOT_FOUND, "인증 신청을 찾을 수 없습니다."));
        boolean isOwner = verification.getVehicle().getUser().getId().equals(session.id());
        boolean isAdmin = "ADMIN".equals(session.role());
        if (!isOwner && !isAdmin)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "본인 차량의 인증 서류만 볼 수 있습니다.");
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(verification.getDocumentMime()))
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .header("X-Content-Type-Options", "nosniff")
            .body(verification.getDocumentData());
    }

    private record DecodedImage(String mime, byte[] data) {}

    private DecodedImage decode(String value) {
        if (value == null || value.length() > 4_200_000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "사진은 3MB 이하로 올려주세요.");
        Matcher matcher = DATA_URL.matcher(value);
        if (!matcher.matches())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "JPG, PNG, WebP 사진만 올릴 수 있어요.");
        String mime = matcher.group(1);
        byte[] data = Base64.getDecoder().decode(matcher.group(2));
        if (!looksLike(mime, data))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "선택한 파일이 이미지 형식과 일치하지 않아요.");
        return new DecodedImage(mime, data);
    }

    // 확장자 위조를 막기 위해 파일의 매직 바이트도 함께 확인한다.
    private boolean looksLike(String mime, byte[] data) {
        return switch (mime) {
            case "image/jpeg" -> data.length >= 3 && (data[0] & 0xFF) == 0xFF
                && (data[1] & 0xFF) == 0xD8 && (data[2] & 0xFF) == 0xFF;
            case "image/png" -> data.length >= 8 && data[0] == (byte) 0x89 && data[1] == 'P'
                && data[2] == 'N' && data[3] == 'G';
            default -> data.length >= 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F'
                && data[3] == 'F' && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P';
        };
    }
}
