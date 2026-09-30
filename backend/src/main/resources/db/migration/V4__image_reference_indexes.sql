-- STEP 10-impl-B: 이미지 공개 여부는 "공개 게시글·매물이 이 이미지를 참조하는가"로 판단한다
-- (board-service/src/image-references.js). image_ids는 배열이라 FK나 B-tree로는 찾을 수 없으므로
-- `image_ids @> ARRAY[id]` 검색에 쓰는 GIN 인덱스를 둔다. 인덱스 추가뿐이라 이전 코드와 함께 떠 있어도 안전하다.
CREATE INDEX board_posts_image_ids_gin ON board_posts USING GIN (image_ids);
CREATE INDEX parts_listings_image_ids_gin ON parts_listings USING GIN (image_ids);
