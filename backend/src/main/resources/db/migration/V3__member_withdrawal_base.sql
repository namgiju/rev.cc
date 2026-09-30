-- STEP 10-impl-A: soft withdrawal(회원탈퇴)의 스키마 기반. 결정 내용은 REVCC_NEXT_TASKS.md STEP 10을 따른다.
-- 컬럼 추가와 허용 값 명시만 한다. 기존 값을 거부하지 않으므로 이전 코드가 함께 떠 있어도 깨지지 않는다.

-- 탈퇴는 users 행을 지우지 않고 WITHDRAWN(되돌릴 수 없는 최종 상태)으로 표시한다.
-- 행을 남겨 두어 게시글·댓글·신고·운영 기록의 참조가 유지된다. 실제 탈퇴 처리는 이후 STEP(10-impl-C)이 한다.
ALTER TABLE users ADD COLUMN withdrawn_at TIMESTAMP(6) WITH TIME ZONE;
-- NULL은 기존 회원(ACTIVE와 같음)이다. 운영 DB는 2026-09-30 기준 전부 NULL이었다.
ALTER TABLE users ADD CONSTRAINT users_account_status_check
 CHECK (account_status IS NULL OR account_status IN ('ACTIVE','SUSPENDED','DISABLED','WITHDRAWN'));

-- 게시글 삭제 기록. 본인 삭제를 soft delete로 바꾸는 동작은 STEP 10-impl-B에서 한다.
-- 지금까지 deleted=true는 관리자 삭제(moderation.js)만 만들었으므로 기존 행은 ADMIN으로 채운다.
-- 기존 행의 삭제 시각과 삭제자는 알 수 없어 NULL로 둔다(관리자·시각은 moderation_logs에 있다).
ALTER TABLE board_posts ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE board_posts ADD COLUMN deleted_by BIGINT REFERENCES users(id);
ALTER TABLE board_posts ADD COLUMN deleted_reason VARCHAR(10)
 CHECK (deleted_reason IS NULL OR deleted_reason IN ('AUTHOR','ADMIN'));
UPDATE board_posts SET deleted_reason = 'ADMIN' WHERE deleted AND deleted_reason IS NULL;
