package com.revcc.app;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth/password-reset")
public class PasswordResetController {
    private final PasswordResetService resets;
    public PasswordResetController(PasswordResetService resets) { this.resets=resets; }
    public record EmailRequest(@NotBlank @Size(max=100) String username, @NotBlank @Email @Size(max=254) String email) {}
    public record VerifyRequest(@NotBlank @Email @Size(max=254) String email, @NotNull @Pattern(regexp="[0-9]{6}") String code) { @Override public String toString() { return "VerifyRequest[redacted]"; } }
    public record ResetRequest(@NotBlank @Size(max=43) String token, @NotBlank @Size(min=AuthController.MIN_PASSWORD_LENGTH, max=255) String password, @NotBlank @Size(max=255) String confirm) { @Override public String toString() { return "ResetRequest[redacted]"; } }
    @PostMapping("/request") public Map<String,String> request(@Valid @RequestBody EmailRequest body, HttpServletRequest request) {
        resets.request(body.username(), body.email(), request.getRemoteAddr()); return message();
    }
    @PostMapping("/verify") public org.springframework.http.ResponseEntity<Map<String,String>> verify(@Valid @RequestBody VerifyRequest body, HttpServletRequest request) {
        return org.springframework.http.ResponseEntity.ok().header("Cache-Control","no-store").body(Map.of("resetToken", resets.verify(body.email(),body.code(),request.getRemoteAddr())));
    }
    @PostMapping("/complete") public Map<String,String> complete(@Valid @RequestBody ResetRequest body) {
        resets.reset(body.token(),body.password(),body.confirm());
        return Map.of("message", "비밀번호가 변경되었습니다. 다시 로그인해주세요.");
    }
    static Map<String,String> message() { return Map.of("code", "CODE_SENT", "message", "인증번호를 발송했습니다."); }
}
