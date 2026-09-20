package com.revcc.app;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.LinkedHashMap;
import java.util.Map;

/** 차고 API의 입력 오류만 처리하며 기존 인증·카탈로그 응답 계약은 변경하지 않는다. */
@RestControllerAdvice(assignableTypes = GarageVehicleController.class)
public class GarageExceptionHandler {
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<?> status(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("message",
            error.getReason() == null ? "요청을 처리할 수 없습니다." : error.getReason()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<?> validation(MethodArgumentNotValidException error) {
        Map<String, String> fields = new LinkedHashMap<>();
        error.getBindingResult().getFieldErrors().forEach(field ->
            fields.putIfAbsent(field.getField(), field.getDefaultMessage() == null ? "입력값을 확인해주세요." : field.getDefaultMessage()));
        return ResponseEntity.badRequest().body(Map.of("message", "필수 항목과 입력 길이, 연식(1900~2100)을 확인해주세요.", "fields", fields));
    }
}
