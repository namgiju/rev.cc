package com.revcc.app;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;

/**
 * 시스템 표시명·운영 주체로 오인될 수 있는 아이디를 새로 만들지 못하게 한다(STEP 10: "탈퇴한 회원" 사칭 방지).
 * 가입, 아이디 중복 확인, 카카오 신규 가입·닉네임 갱신에만 적용하고 기존 아이디와 로그인에는 적용하지 않는다.
 *
 * 비교 전에 NFKC 정규화(전각·호환 문자, 분해된 한글 자모 결합) → 소문자화 → 글자·숫자만 남기기를 한다.
 * 그래서 공백, 밑줄·마침표 같은 구두점, 폭 없는 문자(U+200B 등), 방향 제어 문자, 대소문자를 섞어도 같은 이름으로 본다.
 * 다른 문자 체계의 비슷한 글자(키릴 а 등 homoglyph)까지는 다루지 않는다.
 */
final class ReservedUsernames {
    // 게시판이 탈퇴 작성자 대신 보여 주는 이름. board-service/src/member-display.js와 같은 값이다.
    static final String WITHDRAWN_DISPLAY_NAME = "탈퇴한 회원";
    // 탈퇴 처리(STEP 10-impl-C)가 탈퇴 계정 username으로 쓸 접두어. 미리 선점하지 못하게 막는다.
    static final String WITHDRAWN_USERNAME_PREFIX = "withdrawn:";

    // 정규화한 형태로 적는다. 정확히 같을 때만 막는다(예: "badminton"이나 "차량관리"는 영향 없다).
    private static final Set<String> EXACT = Set.of(
        "탈퇴한사용자", "탈퇴사용자", "탈퇴한계정", "탈퇴계정", "알수없음", "알수없는사용자",
        "관리자", "운영자", "운영진", "운영팀", "관리팀", "시스템", "고객센터",
        "admin", "administrator", "root", "system", "operator", "moderator", "staff", "support",
        "revcc", "revcc관리자", "revcc운영자", "revcc운영팀", "revccadmin", "revccteam", "revccstaff");
    // 이름 안에 들어 있기만 해도 막는다(게시판이 실제로 쓰는 탈퇴 표시명).
    private static final Set<String> CONTAINS = Set.of("탈퇴한회원", "탈퇴회원");
    // 이 접두어로 시작하면 막는다.
    private static final Set<String> PREFIX = Set.of("withdrawn");

    private ReservedUsernames() {}

    static String normalize(String value) {
        String folded = Normalizer.normalize(value, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        StringBuilder kept = new StringBuilder(folded.length());
        folded.codePoints().filter(Character::isLetterOrDigit).forEach(kept::appendCodePoint);
        return kept.toString();
    }

    static boolean isReserved(String username) {
        if (username == null) return false;
        String key = normalize(username);
        return EXACT.contains(key) || CONTAINS.stream().anyMatch(key::contains) || PREFIX.stream().anyMatch(key::startsWith);
    }
}
