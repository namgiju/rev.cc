// 탈퇴 회원(soft withdrawal, STEP 10)의 공개 표시 규칙을 한 곳에 둔다.
// 탈퇴해도 users 행과 작성한 글·댓글·방명록은 남는다. 공개 응답에서는 이름을 "탈퇴한 회원"으로 바꾸고,
// 같은 사람의 글을 다시 묶어 볼 수 있는 내부 회원 id(authorId·sellerId 등)는 내보내지 않는다.
// 관리자 API는 운영에 필요한 내부 id를 그대로 쓴다(이 모듈을 쓰지 않는다).
//
// 아래 함수는 SQL 식을 만든다. 인자는 코드에 적힌 테이블 별칭·컬럼 이름뿐이고 사용자 입력이 아니다.
// Spring의 ReservedUsernames.WITHDRAWN_DISPLAY_NAME과 같은 값을 쓴다(가입 예약어로 막혀 있다).
export const WITHDRAWN_DISPLAY_NAME = "탈퇴한 회원";

// users 별칭 u의 회원이 탈퇴했는지(account_status가 NULL이면 기존 회원 = 탈퇴 아님).
export const isWithdrawnSql = (u) => `COALESCE(${u}.account_status = 'WITHDRAWN', false)`;
// 공개 표시 이름.
export const displayNameSql = (u) =>
  `CASE WHEN ${isWithdrawnSql(u)} THEN '${WITHDRAWN_DISPLAY_NAME}' ELSE ${u}.username END`;
// 탈퇴 회원이면 NULL, 아니면 원래 값(회원 id나 그 회원의 차량 정보처럼 사람을 다시 식별할 수 있는 값).
export const unlessWithdrawnSql = (u, expression) => `CASE WHEN ${isWithdrawnSql(u)} THEN NULL ELSE ${expression} END`;

// pg는 BIGINT를 문자열로 돌려준다. 탈퇴 회원의 NULL은 NULL로 둔다(Number(null)은 0이 되므로 쓰지 않는다).
export const publicMemberId = (value) => (value == null ? null : Number(value));
