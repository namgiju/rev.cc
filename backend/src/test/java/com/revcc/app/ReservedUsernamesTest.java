package com.revcc.app;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** "탈퇴한 회원" 등 시스템 표시명 사칭 방지(STEP 10-impl-A). 정규화로 단순 우회를 막고 일반 아이디는 건드리지 않는다. */
class ReservedUsernamesTest {
    @Test void systemDisplayNamesAndTheirSimpleVariantsAreReserved() {
        for (String name : new String[] {
            "탈퇴한 회원", "탈퇴한회원", " 탈퇴한  회원 ", "탈퇴한_회원", "탈.퇴.한.회.원", "탈퇴한​회원", "‮탈퇴한 회원",
            "탈퇴한　회원", "(탈퇴한 회원)", "탈퇴한 회원2", "나는탈퇴한회원", "탈퇴 회원",
            // 분해된 한글 자모(NFD)도 NFKC로 결합해 같은 이름으로 본다.
            java.text.Normalizer.normalize("탈퇴한 회원", java.text.Normalizer.Form.NFD),
            "관리자", "관 리 자", "운영자", "운영팀", "시스템",
            "admin", "ADMIN", "Admin", "ａｄｍｉｎ", "a d m i n", "Administrator", "root", "System", "moderator",
            "REV.CC", "rev_cc", "REV.CC 관리자", "RevCC-Admin",
            "withdrawn:12", "WITHDRAWN:99", "withdrawn_12", "withdrawn" }) {
            assertTrue(ReservedUsernames.isReserved(name), name);
        }
    }

    @Test void ordinaryUsernamesStayAvailable() {
        for (String name : new String[] {
            "badminton", "admin123", "sysadmin", "차량관리", "관리자님팬", "운영", "회원", "탈퇴",
            "rev", "cc", "revcc2026", "tester", "member-01", "카카오사용자", "홍길동", "withdraw", "withdraws", "", "___" }) {
            assertFalse(ReservedUsernames.isReserved(name), name);
        }
        assertFalse(ReservedUsernames.isReserved(null));
    }

    @Test void displayNameMatchesTheBoardServiceConstant() {
        // board-service/src/member-display.js의 WITHDRAWN_DISPLAY_NAME과 같아야 한다.
        assertEquals("탈퇴한 회원", ReservedUsernames.WITHDRAWN_DISPLAY_NAME);
        assertTrue(ReservedUsernames.isReserved(ReservedUsernames.WITHDRAWN_DISPLAY_NAME));
        assertTrue(ReservedUsernames.isReserved(ReservedUsernames.WITHDRAWN_USERNAME_PREFIX + "1"));
    }
}
