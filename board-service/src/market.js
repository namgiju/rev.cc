import { Router } from "express";
import { fail, text, positive, integer } from "./validation.js";
import { validateOwnedImages } from "./owned-images.js";
import { requireCurrentAdmin } from "./admin-access.js";
import { displayNameSql, isWithdrawnSql, publicMemberId, unlessWithdrawnSql } from "./member-display.js";
import { rateLimiter } from "./rate-limit.js";
const categories = [
  "wheels",
  "suspension",
  "brakes",
  "intake-exhaust",
  "exterior",
  "interior",
  "electronics",
  "engine",
  "other",
];
const statuses = ["selling", "reserved", "sold"];
// 탈퇴 판매자의 매물은 "탈퇴한 회원"으로 보이고 판매자 id는 공개하지 않는다(member-display.js).
const select = `SELECT l.id,${unlessWithdrawnSql("u", "l.seller_id")} AS "sellerId",${displayNameSql("u")} AS username,
 ${isWithdrawnSql("u")} AS "sellerWithdrawn",l.title,l.description,l.price,l.category,l.status,
 l.image_ids AS "imageIds",l.vehicle,l.region,l.views,l.created_at AS "createdAt",l.updated_at AS "updatedAt",
 (SELECT COUNT(*)::int FROM parts_favorites f WHERE f.listing_id=l.id) AS "favoriteCount",
 EXISTS(SELECT 1 FROM parts_favorites f WHERE f.listing_id=l.id AND f.user_id=$1) AS favorited
 FROM parts_listings l JOIN users u ON u.id=l.seller_id`;
const listing = (row) => ({
  ...row,
  sellerId: publicMemberId(row.sellerId),
  price: Number(row.price),
});
const status = (value) => {
  if (!statuses.includes(value)) fail(400, "거래 상태를 확인해주세요.");
  return value;
};
const pattern = (value) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
// 판매자 본인은 그대로 삭제하고, 타인의 매물은 현재 관리자만 사유를 남기고 삭제한다.
// moderation.js의 커뮤니티 삭제와 같은 방식: 행 잠금 후 삭제 직전 원문을 moderation_logs에 남긴다.
export async function deleteListing(db, user, id, reason) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT l.id,l.seller_id,u.username,l.title,l.description,l.category
       FROM parts_listings l JOIN users u ON u.id=l.seller_id WHERE l.id=$1 FOR UPDATE OF l`,
      [id],
    );
    const target = rows[0];
    if (!target) fail(404, "삭제되었거나 없는 매물입니다.");
    if (Number(target.seller_id) !== user.id) {
      if (user.role !== "ADMIN") fail(403, "본인 판매글만 삭제할 수 있어요.");
      const admin = await requireCurrentAdmin(client, user);
      const note = text(reason, 500);
      await client.query(
        `INSERT INTO moderation_logs
        (action_type,category,post_id,post_title,target_id,target_author_id,target_author_username,original_content,reason,admin_id,admin_username)
        VALUES('LISTING_DELETE',$1,$2,$3,$2,$4,$5,$6,$7,$8,$9)`,
        [target.category, target.id, target.title, target.seller_id, target.username,
         target.description, note, admin.id, admin.username],
      );
    }
    await client.query("DELETE FROM parts_listings WHERE id=$1", [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export function marketRouter({ db, auth }) {
  const router = Router();
  const listingLimiter = rateLimiter({ windowMs: 60_000, max: 10, message: "매물 등록이 너무 잦아요. 잠시 후 다시 시도해주세요." });
  // 조회수는 비로그인도 올릴 수 있어 로그인 여부와 관계없이 IP 단위로 제한한다(조회수 부풀리기 방지).
  const viewLimiter = rateLimiter({ windowMs: 60_000, max: 60, by: "ip" });
  router.param("id", (req, res, next, id) => {
    req.params.id = positive(id);
    next();
  });
  async function input(body, userId) {
    const title = text(body?.title, 150),
      description = text(body?.description, 5000),
      price = integer(body?.price, 0, 2000000000);
    if (!categories.includes(body?.category))
      fail(400, "부품 카테고리를 확인해주세요.");
    return [
      title,
      description,
      price,
      body.category,
      status(body.status ?? "selling"),
      await validateOwnedImages(db, body.imageIds ?? [], userId),
      text(body.vehicle, 200),
      text(body.region, 100),
      text(body.contact, 300),
    ];
  }
  async function exists(id) {
    const { rows } = await db.query(
      "SELECT id FROM parts_listings WHERE id=$1",
      [id],
    );
    if (!rows.length) fail(404, "삭제되었거나 없는 매물입니다.");
  }
  router.get("/", async (req, res) => {
    const {
      q = "",
      category = "",
      status: state = "",
      region = "",
      vehicle = "",
      sort = "latest",
      scope = "",
    } = req.query;
    if (category && !categories.includes(category))
      fail(400, "부품 카테고리를 확인해주세요.");
    if (state) status(state);
    if (
      !["latest", "popular", "price-low", "price-high"].includes(sort) ||
      !["", "mine", "favorites"].includes(scope)
    )
      fail(400, "정렬 또는 범위를 확인해주세요.");
    if (scope && !req.user) fail(401, "로그인이 필요합니다.");
    const page = positive(req.query.page ?? 1),
      limit =
        req.query.limit === undefined
          ? 12
          : integer(Number(req.query.limit), 1, 48);
    const values = [
      req.user?.id ?? null,
      pattern(text(q, 100, false)),
      category,
      state,
      pattern(text(region, 100, false)),
      pattern(text(vehicle, 200, false)),
    ];
    let where = ` WHERE (l.title ILIKE $2 OR l.description ILIKE $2 OR l.vehicle ILIKE $2) AND ($3='' OR l.category=$3) AND ($4='' OR l.status=$4) AND l.region ILIKE $5 AND l.vehicle ILIKE $6`;
    if (scope === "mine") where += " AND l.seller_id=$1";
    if (scope === "favorites")
      where +=
        " AND EXISTS(SELECT 1 FROM parts_favorites f WHERE f.listing_id=l.id AND f.user_id=$1)";
    const order = {
      latest: "l.id DESC",
      popular: '"favoriteCount" DESC,l.views DESC,l.id DESC',
      "price-low": "l.price ASC,l.id DESC",
      "price-high": "l.price DESC,l.id DESC",
    }[sort];
    // One statement keeps page items and total consistent, including an empty out-of-range page.
    const { rows } = await db.query(
      `WITH filtered AS (${select + where}), page_items AS
     (SELECT * FROM filtered l ORDER BY ${order} LIMIT $7 OFFSET $8)
     SELECT (SELECT COUNT(*)::int FROM filtered) AS total,COALESCE((SELECT json_agg(page_items) FROM page_items),'[]'::json) AS items`,
      [...values, limit, (page - 1) * limit],
    );
    res.json({
      items: rows[0].items.map(listing),
      total: rows[0].total,
      page,
      limit,
    });
  });
  router.post("/", auth, listingLimiter, async (req, res) => {
    const values = await input(req.body, req.user.id);
    const { rows } = await db.query(
      `INSERT INTO parts_listings(seller_id,title,description,price,category,status,image_ids,vehicle,region,contact)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [req.user.id, ...values],
    );
    res.status(201).json(rows[0]);
  });
  router.get("/:id", async (req, res) => {
    const { rows } = await db.query(select + " WHERE l.id=$2", [
      req.user?.id ?? null,
      req.params.id,
    ]);
    if (!rows.length) fail(404, "삭제되었거나 없는 매물입니다.");
    const result = listing(rows[0]);
    // 탈퇴 판매자에게는 연락할 수 없으므로 연락처(개인정보)를 내려주지 않는다. 값 자체의 정리는 탈퇴 처리가 한다.
    if (req.user && !result.sellerWithdrawn) {
      const contact = await db.query(
        "SELECT contact FROM parts_listings WHERE id=$1",
        [req.params.id],
      );
      result.contact = contact.rows[0]?.contact ?? "";
    }
    res.json(result);
  });
  router.put("/:id", auth, async (req, res) => {
    const values = await input(req.body, req.user.id);
    const { rowCount } = await db.query(
      `UPDATE parts_listings SET title=$3,description=$4,price=$5,category=$6,status=$7,image_ids=$8,vehicle=$9,region=$10,contact=$11,updated_at=NOW() WHERE id=$1 AND seller_id=$2`,
      [req.params.id, req.user.id, ...values],
    );
    if (!rowCount) fail(403, "본인 판매글만 수정할 수 있어요.");
    res.json({ id: req.params.id });
  });
  router.patch("/:id/status", auth, async (req, res) => {
    const value = status(req.body?.status);
    const { rowCount } = await db.query(
      "UPDATE parts_listings SET status=$3,updated_at=NOW() WHERE id=$1 AND seller_id=$2",
      [req.params.id, req.user.id, value],
    );
    if (!rowCount) fail(403, "본인 판매글만 변경할 수 있어요.");
    res.json({ ok: true });
  });
  router.delete("/:id", auth, async (req, res) => {
    await deleteListing(db, req.user, req.params.id, req.body?.reason);
    res.json({ ok: true });
  });
  router.put("/:id/favorite", auth, async (req, res) => {
    if (typeof req.body?.active !== "boolean")
      fail(400, "관심 상태를 확인해주세요.");
    await exists(req.params.id);
    if (req.body.active)
      await db.query(
        "INSERT INTO parts_favorites(listing_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [req.params.id, req.user.id],
      );
    else
      await db.query(
        "DELETE FROM parts_favorites WHERE listing_id=$1 AND user_id=$2",
        [req.params.id, req.user.id],
      );
    res.json({ ok: true });
  });
  router.post("/:id/view", viewLimiter, async (req, res) => {
    const { rows } = await db.query(
      "UPDATE parts_listings SET views=views+1 WHERE id=$1 RETURNING views",
      [req.params.id],
    );
    if (!rows.length) fail(404, "삭제되었거나 없는 매물입니다.");
    res.json(rows[0]);
  });
  return router;
}
