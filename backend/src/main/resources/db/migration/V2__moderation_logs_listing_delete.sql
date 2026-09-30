-- 부품 매물 관리자 삭제(LISTING_DELETE) 로그 허용. 이전에는 board-service schema.sql이 부팅 때 적용했다.
-- post_id/target_id는 매물 id, post_title은 매물 제목, category는 부품 카테고리,
-- original_content는 매물 설명이다. 허용 값만 늘어나므로 기존 로그에는 영향이 없다.
ALTER TABLE moderation_logs DROP CONSTRAINT IF EXISTS moderation_logs_action_type_check;
ALTER TABLE moderation_logs ADD CONSTRAINT moderation_logs_action_type_check
 CHECK(action_type IN ('POST_DELETE','COMMENT_DELETE','REPLY_DELETE','LISTING_DELETE'));
