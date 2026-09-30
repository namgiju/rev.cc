-- STEP 10-impl-C: 회원 탈퇴 처리에 필요한 스키마. 결정 내용은 REVCC_NEXT_TASKS.md STEP 10을 따른다.

-- 탈퇴 회원의 판매중 매물은 지우지 않고 비공개(closed)로 닫는다. 사용자가 고를 수 있는 상태는 아니다.
-- 운영 DB(Neon)의 CHECK는 V1 이전의 board schema.sql이 만들었으므로 이름에 기대지 않고 정의로 찾아 바꾼다.
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'parts_listings'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%' AND pg_get_constraintdef(oid) LIKE '%reserved%'
  LOOP
    EXECUTE format('ALTER TABLE parts_listings DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
ALTER TABLE parts_listings ADD CONSTRAINT parts_listings_status_check
 CHECK (status IN ('selling','reserved','sold','closed'));
ALTER TABLE parts_listings ADD COLUMN closed_at TIMESTAMPTZ;

-- 탈퇴 후 재가입 제한. 이메일·카카오 id·아이디 원문은 저장하지 않고 WITHDRAWAL_HMAC_SECRET으로 만든
-- HMAC-SHA256(소문자 hex 64자)만 둔다. CHECK로 hex 이외의 값(원문)이 들어가지 못하게 한다.
-- COOLDOWN: 모든 탈퇴에 30일. SANCTION: 제재 중 탈퇴(정지는 종료일과 30일 중 늦은 날, 비활성화는 무기한).
-- expires_at IS NULL은 관리자가 행을 지워 해제할 때까지 유지된다는 뜻이다. 만료 행 정리는 STEP 10-impl-E에서 한다.
CREATE TABLE withdrawal_blocks (
 id BIGSERIAL PRIMARY KEY,
 identifier_type VARCHAR(10) NOT NULL CHECK (identifier_type IN ('EMAIL','KAKAO','USERNAME')),
 identifier_hmac CHAR(64) NOT NULL CHECK (identifier_hmac ~ '^[0-9a-f]{64}$'),
 reason VARCHAR(10) NOT NULL CHECK (reason IN ('COOLDOWN','SANCTION')),
 user_id BIGINT NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ
);
CREATE INDEX withdrawal_blocks_identifier ON withdrawal_blocks(identifier_type, identifier_hmac);
