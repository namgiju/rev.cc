package com.revcc.app;

import java.util.Map;
import org.hibernate.exception.JDBCConnectionException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * DB에 연결하지 못한 요청(풀 대기 시간 초과, DB 다운, 네트워크 단절)을 500 대신 503으로 끝낸다.
 * Hikari connection-timeout이 대기 시간을 제한하므로 요청이 무한히 매달리지 않는다.
 * 내부 오류 메시지(호스트 등)는 응답에 싣지 않는다.
 */
@RestControllerAdvice
public class DatabaseUnavailableHandler {
    @ExceptionHandler({CannotCreateTransactionException.class, CannotGetJdbcConnectionException.class,
        DataAccessResourceFailureException.class, JDBCConnectionException.class})
    public ResponseEntity<?> unavailable(Exception e) {
        return ResponseEntity.status(503).header(HttpHeaders.RETRY_AFTER, "5").header(HttpHeaders.CACHE_CONTROL, "no-store")
            .body(Map.of("message", "일시적으로 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해주세요."));
    }
}
