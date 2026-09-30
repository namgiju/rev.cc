package com.revcc.app;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * 탈퇴 후 재가입 제한(STEP 10-impl-C, withdrawal_blocks). 식별값 원문(이메일·카카오 id·아이디)은 저장하지 않고
 * WITHDRAWAL_HMAC_SECRET으로 만든 HMAC-SHA256만 저장·비교한다. 비밀값 없이 단순 해시를 쓰면 흔한 이메일·아이디를
 * 사전 대입으로 되돌릴 수 있기 때문이다.
 *
 * 비밀값이 없거나 짧으면(32자 미만) 탈퇴 자체를 받지 않고(503), 이미 제한 행이 남아 있는 DB에서는 가입 확인도
 * 503으로 막는다(제한을 조용히 건너뛰지 않는다). 운영(prod 프로파일)은 비밀값이 없으면 기동하지 않는다.
 * 비밀값을 바꾸면 기존 행은 더 이상 일치하지 않아 제한이 풀린다(교체 절차는 docs/member-withdrawal.md).
 */
@Component
public class WithdrawalBlocks {
    public enum Type { EMAIL, KAKAO, USERNAME }
    static final String MESSAGE = "탈퇴 후 30일 동안은 같은 정보로 가입할 수 없습니다.";
    private final JdbcTemplate jdbc;
    private final String secret;

    public WithdrawalBlocks(JdbcTemplate jdbc, @Value("${app.withdrawal.hmac-secret:}") String secret,
            @Value("${app.withdrawal.require-secret:false}") boolean requireSecret) {
        this.jdbc = jdbc;
        this.secret = secret == null ? "" : secret;
        if (requireSecret && !configured())
            throw new IllegalStateException("WITHDRAWAL_HMAC_SECRET(32자 이상)을 설정해야 합니다.");
    }

    boolean configured() { return secret.length() >= 32; }

    /** 입력은 종류 접두어를 붙여 서로 다른 종류의 같은 문자열이 같은 값이 되지 않게 한다. */
    String hmac(Type type, String value) {
        if (!configured()) throw unavailable();
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal((type.name().toLowerCase(java.util.Locale.ROOT) + ":" + value).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) { throw new IllegalStateException("재가입 제한 처리 실패"); }
    }

    /** 아직 유효한 제한이 있는지. 값은 가입과 같은 정규화를 거친 값이어야 한다(이메일은 PasswordResetService.email, 아이디는 원문 그대로). */
    public boolean blocked(Type type, String value) {
        if (value == null) return false;
        if (!configured()) {
            // 비밀값이 없으면 비교할 수 없다. 제한 행이 하나라도 살아 있으면 가입을 막고, 없으면 제한할 대상도 없다.
            Boolean any = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM withdrawal_blocks WHERE expires_at IS NULL OR expires_at > NOW())", Boolean.class);
            if (Boolean.TRUE.equals(any)) throw unavailable();
            return false;
        }
        Boolean found = jdbc.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM withdrawal_blocks WHERE identifier_type=? AND identifier_hmac=?
            AND (expires_at IS NULL OR expires_at > NOW()))""", Boolean.class, type.name(), hmac(type, value));
        return Boolean.TRUE.equals(found);
    }

    /** until이 null이면 무기한(관리자가 해제할 때까지). */
    void record(long userId, Type type, String value, String reason, Instant until) {
        if (value == null) return;
        jdbc.update("INSERT INTO withdrawal_blocks(identifier_type,identifier_hmac,reason,user_id,expires_at) VALUES(?,?,?,?,?)",
            type.name(), hmac(type, value), reason, userId, until == null ? null : java.sql.Timestamp.from(until));
    }

    static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "회원 탈퇴 설정이 필요합니다. 관리자에게 문의해주세요.");
    }
}
