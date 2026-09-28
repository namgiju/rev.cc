import { fail, positive } from "./validation.js";
export async function validateOwnedImages(db, ids, userId) {
  if (!Array.isArray(ids) || ids.length > 3)
    fail(400, "사진은 최대 3장까지 첨부할 수 있어요.");
  const normalized = [...new Set(ids.map(positive))];
  if (normalized.length) {
    const { rows } = await db.query(
      "SELECT id FROM community_images WHERE id=ANY($1::int[]) AND owner_id=$2",
      [normalized, userId],
    );
    if (rows.length !== normalized.length)
      fail(400, "직접 업로드한 사진을 선택해주세요.");
  }
  return normalized;
}
