# 회원 탈퇴 운영 메모 (STEP 10-impl-C)

정책 결정은 `REVCC_NEXT_TASKS.md`의 STEP 10에 있다. 이 문서는 운영에 필요한 설정과 절차만 적는다.

## WITHDRAWAL_HMAC_SECRET

- 탈퇴 후 재가입 제한(`withdrawal_blocks`)은 이메일·카카오 id·아이디의 원문을 저장하지 않는다. 이 키로 만든 HMAC-SHA256만 저장한다.
- 32자 이상의 난수를 쓴다. 예: `openssl rand -hex 32`. 채팅이나 커밋에 붙여 넣지 않는다.
- prod 오버레이(`docker-compose.prod.yml`)와 prod 프로파일은 이 값이 없으면 core를 기동하지 않는다.
- prod가 아닌 환경에서 비어 있으면 회원 탈퇴 요청을 503으로 거부한다. 이미 제한 행이 있는 DB라면 가입 확인도 503으로 막는다. 제한을 조용히 건너뛰지 않는다.

### 키 교체

기존 행은 이전 키로 만든 값이다. 키를 바꾸면 기존 행은 더 이상 일치하지 않아 모든 재가입 제한이 풀린다. 원문을 저장하지 않으므로 새 키로 다시 계산할 수도 없다.

1. 키가 유출된 경우가 아니면 교체하지 않는다.
2. 교체해야 하면 남은 제한 기간을 확인한다(읽기 전용):
   `SELECT reason, count(*), max(expires_at) FROM withdrawal_blocks WHERE expires_at IS NULL OR expires_at > NOW() GROUP BY reason;`
3. 기간 제한(COOLDOWN, 기한 있는 SANCTION)은 교체 후 풀린다는 점을 받아들이고 교체한다. 무기한 SANCTION(`expires_at IS NULL`)이 있다면, 해당 회원의 운영 기록(`admin_member_actions`, `moderation_logs`)을 남겨 두고 수동으로 관리한다.
4. 교체 후 이전 키로 만든 행은 E(정리 작업)에서 만료 행과 함께 지운다.

## 무기한 제한 해제

비활성화(DISABLED) 상태에서 탈퇴한 회원은 `expires_at IS NULL`인 SANCTION 행이 남는다. 지금은 관리자 화면이 없다. 해제하려면 운영자가 해당 `user_id`의 SANCTION 행을 직접 삭제한다. 이 작업은 관리자 기록 화면에 남지 않으므로 별도로 기록한다.

## 한계

- 이메일 없이 가입한 일반 계정은 아이디 HMAC만 남는다. 새 아이디로 다시 가입하는 것은 막을 수 없다.
- 카카오 계정 탈퇴는 STEP 10-impl-D(카카오 재인증 + 연결 끊기) 전까지 거부된다.
