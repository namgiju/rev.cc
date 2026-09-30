import { isWithdrawnSql } from "./member-display.js";

// community_images의 공개 규칙(STEP 10-impl-B)을 한 곳에 둔다. 이미지 id를 안다는 것만으로는 공개하지 않고,
// 지금 공개된 데이터가 그 이미지를 참조할 때만 누구에게나 보여 준다.
//  - 삭제되지 않은 게시글의 image_ids (탈퇴 작성자의 글도 공개 글이므로 포함)
//  - 매물의 image_ids (매물은 삭제하면 행이 없어진다)
//  - 탈퇴하지 않은 회원의 프로필 avatar/cover, 차량 image_id
// 인자는 코드에 적힌 테이블 별칭뿐이고 사용자 입력이 아니다.
export const publicImageSql = (i) => `(
  EXISTS(SELECT 1 FROM board_posts rp WHERE NOT rp.deleted AND rp.image_ids @> ARRAY[${i}.id])
  OR EXISTS(SELECT 1 FROM parts_listings rl WHERE rl.image_ids @> ARRAY[${i}.id])
  OR EXISTS(SELECT 1 FROM member_profiles rm JOIN users ru ON ru.id=rm.user_id
            WHERE (rm.avatar_image_id=${i}.id OR rm.cover_image_id=${i}.id) AND NOT ${isWithdrawnSql("ru")})
  OR EXISTS(SELECT 1 FROM owner_vehicles rv JOIN users ru ON ru.id=rv.owner_id
            WHERE rv.image_id=${i}.id AND NOT ${isWithdrawnSql("ru")}))`;

// 게시글·매물 응답의 image_ids는 실제로 남아 있는 이미지만, 저장된 순서대로 돌려준다(과거 데이터 방어).
export const existingImageIdsSql = (column) =>
  `ARRAY(SELECT e.id FROM unnest(${column}) WITH ORDINALITY AS e(id,n)
   WHERE EXISTS(SELECT 1 FROM community_images ei WHERE ei.id=e.id) ORDER BY e.n)`;
