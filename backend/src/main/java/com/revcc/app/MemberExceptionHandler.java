package com.revcc.app;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
@RestControllerAdvice(assignableTypes={AdminMemberController.class,PasswordResetController.class})
public class MemberExceptionHandler {
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<?> status(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).header("Cache-Control","no-store").body(Map.of("message", e.getReason()==null ? "요청을 처리할 수 없습니다." : e.getReason()));
    }
    @ExceptionHandler(org.springframework.web.bind.MethodArgumentNotValidException.class)
    public ResponseEntity<?> invalid() { return ResponseEntity.badRequest().body(Map.of("message","입력 형식과 길이를 확인해주세요.")); }
}
