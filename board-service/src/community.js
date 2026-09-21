import { Router } from "express";

const categories = ["free", "maintenance", "parts", "drive"];
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
function text(value, max, required = true) {
  if (value === undefined && !required) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail(400, `입력 내용을 확인해주세요. (최대 ${max}자)`);
  return value.trim();
}
function positive(value) {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > 2147483647
  )
    fail(400, "올바른 항목을 선택해주세요.");
  return Number(value);
}
function integer(value, min, max, optional = false) {
  if (optional && (value === "" || value == null)) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    fail(400, "숫자 입력 범위를 확인해주세요.");
  return value;
}
export function decodeImage(value) {
  if (typeof value !== "string" || value.length > 4200000)
    fail(400, "사진은 3MB 이하로 올려주세요.");
  const match =
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match) fail(400, "JPG, PNG, WebP 사진만 올릴 수 있어요.");
  const data = Buffer.from(match[2], "base64");
  const mime = match[1];
  const valid =
    mime === "image/jpeg"
      ? data.length >= 4 &&
        data[0] === 255 &&
        data[1] === 216 &&
        data[2] === 255
      : mime === "image/png"
        ? data
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : data.toString("ascii", 0, 4) === "RIFF" &&
          data.toString("ascii", 8, 12) === "WEBP";
  if (!valid || !data.length || data.length > 3 * 1024 * 1024)
    fail(400, "지원하지 않거나 너무 큰 사진입니다.");
  return { mime, data };
}
const postSelect = `SELECT p.id,p.title,p.content,p.author_id AS "authorId",u.username,
 p.created_at AS "createdAt",p.updated_at AS "updatedAt",p.category,p.vehicle,p.image_ids AS "imageIds",p.views,
 (SELECT COUNT(*)::int FROM board_comments c WHERE c.post_id=p.id AND NOT c.deleted) AS "commentCount",
 (SELECT COUNT(*)::int FROM board_likes l WHERE l.post_id=p.id) AS "likeCount",
 EXISTS(SELECT 1 FROM board_likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked,
 EXISTS(SELECT 1 FROM board_bookmarks b WHERE b.post_id=p.id AND b.user_id=$1) AS bookmarked,
 (SELECT model FROM owner_vehicles v WHERE v.owner_id=p.author_id ORDER BY v.id LIMIT 1) AS "ownerVehicle"
 FROM board_posts p JOIN users u ON u.id=p.author_id`;
const asPost = (row) => ({ ...row, authorId: Number(row.authorId) });

// Asia/Seoul(KST, UTC+9는 서머타임이 없어 상수로 계산해도 안전하다) 기준 오늘 00:00을
// 해당 UTC 시각으로 변환한다. period=today 필터에 사용한다.
function todayStartKst() {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  const kstMidnightAsUtc = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
  );
  return new Date(kstMidnightAsUtc - KST_OFFSET_MS);
}

export function communityRouter({ db, auth }) {
  const router = Router();
  router.param("id", (req, res, next, id) => {
    req.params.id = positive(id);
    next();
  });
  router.param("commentId", (req, res, next, id) => {
    req.params.commentId = positive(id);
    next();
  });
  router.param("recordId", (req, res, next, id) => {
    req.params.recordId = positive(id);
    next();
  });
  const exists = async (id) => {
    const { rows } = await db.query(
      "SELECT id,author_id FROM board_posts WHERE id=$1",
      [id],
    );
    if (!rows.length) fail(404, "삭제되었거나 없는 글입니다.");
    return rows[0];
  };
  async function images(ids, userId) {
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
  async function postInput(body, userId) {
    const {
      title,
      content,
      category = "free",
      vehicle = "",
      imageIds = [],
    } = body ?? {};
    if (!categories.includes(category))
      fail(400, "게시판 분류를 선택해주세요.");
    return [
      text(title, 150),
      text(content, 5000),
      userId,
      category,
      text(vehicle, 100, false),
      await images(imageIds, userId),
    ];
  }
  router.post("/images", auth, async (req, res) => {
    const { mime, data } = decodeImage(req.body?.data);
    const { rows } = await db.query(
      "INSERT INTO community_images(owner_id,mime,data) VALUES($1,$2,$3) RETURNING id",
      [req.user.id, mime, data],
    );
    res
      .status(201)
      .json({ id: rows[0].id, url: `/api/board/images/${rows[0].id}` });
  });
  router.get("/images/:id", async (req, res) => {
    const { rows } = await db.query(
      "SELECT mime,data FROM community_images WHERE id=$1",
      [req.params.id],
    );
    if (!rows.length) fail(404, "사진을 찾을 수 없습니다.");
    res
      .set("X-Content-Type-Options", "nosniff")
      .type(rows[0].mime)
      .send(rows[0].data);
  });
  router.get("/posts", async (req, res) => {
    const {
      q = "",
      category = "",
      sort = "latest",
      scope = "",
      vehicle = "",
      period = "",
    } = req.query;
    const query = text(q, 100, false),
      model = text(vehicle, 100, false);
    if (category && !categories.includes(category))
      fail(400, "올바른 분류를 선택해주세요.");
    if (
      !["latest", "popular"].includes(sort) ||
      !["", "mine", "bookmarks", "commented"].includes(scope)
    )
      fail(400, "올바른 정렬을 선택해주세요.");
    if (period && period !== "today") fail(400, "지원하지 않는 기간입니다.");
    if (scope && !req.user) fail(401, "로그인이 필요합니다.");
    const page = positive(req.query.page ?? 1);
    const limit =
      req.query.limit === undefined
        ? 100
        : integer(Number(req.query.limit), 1, 100);
    const values = [
      req.user?.id ?? null,
      `%${query.replace(/[\\%_]/g, "\\$&")}%`,
      category,
      `%${model.replace(/[\\%_]/g, "\\$&")}%`,
      period === "today" ? todayStartKst() : null,
    ];
    let where = ` WHERE (p.title ILIKE $2 OR p.content ILIKE $2 OR u.username ILIKE $2) AND ($3='' OR p.category=$3) AND p.vehicle ILIKE $4 AND ($5::timestamptz IS NULL OR p.created_at>=$5)`;
    if (scope === "mine") where += " AND p.author_id=$1";
    if (scope === "bookmarks")
      where +=
        " AND EXISTS(SELECT 1 FROM board_bookmarks b WHERE b.post_id=p.id AND b.user_id=$1)";
    if (scope === "commented")
      where +=
        " AND EXISTS(SELECT 1 FROM board_comments c WHERE c.post_id=p.id AND c.author_id=$1 AND NOT c.deleted)";
    const order =
      sort === "popular"
        ? '"likeCount" DESC,"commentCount" DESC,p.id DESC'
        : "p.id DESC";
    const { rows } = await db.query(
      postSelect + where + ` ORDER BY ${order} LIMIT $6 OFFSET $7`,
      [...values, limit, (page - 1) * limit],
    );
    res.json(rows.map(asPost));
  });
  router.post("/posts", auth, async (req, res) => {
    const values = await postInput(req.body, req.user.id);
    const { rows } = await db.query(
      `INSERT INTO board_posts(title,content,author_id,category,vehicle,image_ids)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,title,content,author_id AS "authorId"`,
      values,
    );
    res.status(201).json(asPost(rows[0]));
  });
  router.get("/posts/:id", async (req, res) => {
    const { rows } = await db.query(postSelect + " WHERE p.id=$2", [
      req.user?.id ?? null,
      req.params.id,
    ]);
    if (!rows.length) fail(404, "삭제되었거나 없는 글입니다.");
    res.json(asPost(rows[0]));
  });
  router.post("/posts/:id/view", async (req, res) => {
    const { rows } = await db.query(
      "UPDATE board_posts SET views=views+1 WHERE id=$1 RETURNING views",
      [req.params.id],
    );
    if (!rows.length) fail(404, "삭제되었거나 없는 글입니다.");
    res.json(rows[0]);
  });
  router.put("/posts/:id", auth, async (req, res) => {
    const values = await postInput(req.body, req.user.id);
    const { rows } = await db.query(
      `UPDATE board_posts SET title=$1,content=$2,category=$4,vehicle=$5,image_ids=$6,updated_at=NOW()
      WHERE id=$7 AND author_id=$3 RETURNING id`,
      [...values, req.params.id],
    );
    if (!rows.length) fail(403, "본인이 작성한 글만 수정할 수 있어요.");
    res.json(rows[0]);
  });
  router.delete("/posts/:id", auth, async (req, res) => {
    const { rowCount } = await db.query(
      "DELETE FROM board_posts WHERE id=$1 AND author_id=$2",
      [req.params.id, req.user.id],
    );
    if (!rowCount) fail(403, "본인이 작성한 글만 삭제할 수 있어요.");
    res.json({ ok: true });
  });
  for (const [route, table] of [
    ["like", "board_likes"],
    ["bookmark", "board_bookmarks"],
  ]) {
    router.put(`/posts/:id/${route}`, auth, async (req, res) => {
      await exists(req.params.id);
      if (typeof req.body?.active !== "boolean")
        fail(400, "상태를 선택해주세요.");
      if (req.body.active)
        await db.query(
          `INSERT INTO ${table}(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
          [req.params.id, req.user.id],
        );
      else
        await db.query(`DELETE FROM ${table} WHERE post_id=$1 AND user_id=$2`, [
          req.params.id,
          req.user.id,
        ]);
      res.json({ active: req.body.active });
    });
  }
  router.get("/posts/:id/comments", async (req, res) => {
    await exists(req.params.id);
    const { rows } = await db.query(
      `SELECT c.id,c.content,c.deleted,c.parent_id AS "parentId",c.author_id AS "authorId",u.username,c.created_at AS "createdAt"
      FROM board_comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=$1 ORDER BY c.id`,
      [req.params.id],
    );
    res.json(rows.map((c) => ({ ...c, authorId: Number(c.authorId) })));
  });
  router.post("/posts/:id/comments", auth, async (req, res) => {
    const content = text(req.body?.content, 2000);
    const parent =
      req.body?.parentId == null ? null : positive(req.body.parentId);
    // Insert, parent validation and notification are one atomic statement.
    const { rows } = await db.query(
      `WITH target AS (
      SELECT p.id,p.author_id,pc.author_id AS parent_author FROM board_posts p
      LEFT JOIN board_comments pc ON pc.id=$4 AND pc.post_id=p.id AND pc.parent_id IS NULL AND NOT pc.deleted
      WHERE p.id=$1 AND ($4::int IS NULL OR pc.id IS NOT NULL)
    ), inserted AS (
      INSERT INTO board_comments(post_id,author_id,content,parent_id) SELECT id,$2,$3,$4 FROM target RETURNING *
    ), notified AS (
      INSERT INTO community_notifications(user_id,actor_id,post_id,kind)
      SELECT DISTINCT recipient,$2,i.post_id,'comment' FROM inserted i CROSS JOIN target t
      CROSS JOIN LATERAL unnest(ARRAY[t.author_id,t.parent_author]) recipient
      WHERE recipient IS NOT NULL AND recipient<>$2
    ) SELECT id FROM inserted`,
      [req.params.id, req.user.id, content, parent],
    );
    if (!rows.length) fail(404, "글 또는 답글을 달 댓글을 찾을 수 없어요.");
    res.status(201).json(rows[0]);
  });
  router.delete("/comments/:commentId", auth, async (req, res) => {
    const { rowCount } = await db.query(
      `UPDATE board_comments SET content='삭제된 댓글입니다.',deleted=true WHERE id=$1 AND author_id=$2 AND NOT deleted`,
      [req.params.commentId, req.user.id],
    );
    if (!rowCount) fail(403, "본인이 작성한 댓글만 삭제할 수 있어요.");
    res.json({ ok: true });
  });
  router.post("/posts/:id/report", auth, async (req, res) => {
    await exists(req.params.id);
    const reason = text(req.body?.reason, 500);
    const { rows } = await db.query(
      `INSERT INTO community_reports(user_id,post_id,reason) VALUES($1,$2,$3)
      ON CONFLICT(user_id,post_id) DO UPDATE SET reason=EXCLUDED.reason RETURNING id`,
      [req.user.id, req.params.id, reason],
    );
    res.status(201).json(rows[0]);
  });
  router.get("/reports", auth, async (req, res) => {
    const { rows } = await db.query(
      `SELECT r.id,r.reason,r.status,r.created_at AS "createdAt",p.id AS "postId",p.title,p.category
      FROM community_reports r JOIN board_posts p ON p.id=r.post_id WHERE r.user_id=$1 ORDER BY r.id DESC LIMIT 100`,
      [req.user.id],
    );
    res.json(rows);
  });
  router.get("/notifications", auth, async (req, res) => {
    const { rows } = await db.query(
      `SELECT n.id,n.post_id AS "postId",n.is_read AS "isRead",n.created_at AS "createdAt",p.title,p.category,u.username,n.kind
      FROM community_notifications n JOIN board_posts p ON p.id=n.post_id JOIN users u ON u.id=n.actor_id
      WHERE n.user_id=$1 ORDER BY n.id DESC LIMIT 100`,
      [req.user.id],
    );
    res.json(rows);
  });
  router.put("/notifications/read", auth, async (req, res) => {
    await db.query(
      "UPDATE community_notifications SET is_read=true WHERE user_id=$1",
      [req.user.id],
    );
    res.json({ ok: true });
  });
  router.get("/members/:id", async (req, res) => {
    const { rows } = await db.query(
      "SELECT id,username FROM users WHERE id=$1",
      [req.params.id],
    );
    if (!rows.length) fail(404, "회원을 찾을 수 없어요.");
    const posts = await db.query(
      postSelect + " WHERE p.author_id=$2 ORDER BY p.id DESC LIMIT 30",
      [req.user?.id ?? null, req.params.id],
    );
    res.json({
      ...rows[0],
      id: Number(rows[0].id),
      posts: posts.rows.map(asPost),
    });
  });
  // 차종별 게시판 1차 구현: board_posts.vehicle은 자유 텍스트라 owner_vehicles/vehicles와
  // FK로 묶지 않고 단순 집계만 한다. 정규화는 추후 과제로 남긴다.
  router.get("/vehicles/popular", async (req, res) => {
    const limit =
      req.query.limit === undefined
        ? 8
        : integer(Number(req.query.limit), 1, 50);
    const { rows } = await db.query(
      `SELECT vehicle, COUNT(*)::int AS "postCount" FROM board_posts
      WHERE vehicle IS NOT NULL AND vehicle<>'' GROUP BY vehicle
      ORDER BY "postCount" DESC, vehicle ASC LIMIT $1`,
      [limit],
    );
    res.json(rows);
  });
  router.get("/garage", async (req, res) => {
    const owner =
      req.query.owner === undefined ? null : positive(req.query.owner);
    const { rows } = await db.query(
      `SELECT v.id,v.owner_id AS "ownerId",u.username,v.model,v.year,v.trim,v.bio,v.image_id AS "imageId",
      (SELECT COUNT(*)::int FROM vehicle_records r WHERE r.vehicle_id=v.id) AS "recordCount"
      FROM owner_vehicles v JOIN users u ON u.id=v.owner_id WHERE ($1::bigint IS NULL OR v.owner_id=$1) ORDER BY v.id DESC LIMIT 100`,
      [owner],
    );
    res.json(rows.map((v) => ({ ...v, ownerId: Number(v.ownerId) })));
  });
  async function vehicleInput(body, userId) {
    const model = text(body?.model, 100),
      year = integer(body?.year, 1900, new Date().getFullYear() + 1);
    const trim = text(body?.trim, 100, false),
      bio = text(body?.bio, 1000, false);
    const imageId = body?.imageId == null ? null : positive(body.imageId);
    if (imageId) await images([imageId], userId);
    return [userId, model, year, trim, bio, imageId];
  }
  router.post("/garage", auth, async (req, res) => {
    const { rows } = await db.query(
      `INSERT INTO owner_vehicles(owner_id,model,year,trim,bio,image_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      await vehicleInput(req.body, req.user.id),
    );
    res.status(201).json(rows[0]);
  });
  router.put("/garage/:id", auth, async (req, res) => {
    const values = await vehicleInput(req.body, req.user.id);
    const { rows } = await db.query(
      `UPDATE owner_vehicles SET model=$2,year=$3,trim=$4,bio=$5,image_id=$6,updated_at=NOW() WHERE owner_id=$1 AND id=$7 RETURNING id`,
      [...values, req.params.id],
    );
    if (!rows.length) fail(403, "본인 차량만 수정할 수 있어요.");
    res.json(rows[0]);
  });
  router.delete("/garage/:id", auth, async (req, res) => {
    const { rowCount } = await db.query(
      "DELETE FROM owner_vehicles WHERE id=$1 AND owner_id=$2",
      [req.params.id, req.user.id],
    );
    if (!rowCount) fail(403, "본인 차량만 삭제할 수 있어요.");
    res.json({ ok: true });
  });
  router.get("/garage/:id", async (req, res) => {
    const { rows } = await db.query(
      `SELECT v.id,v.owner_id AS "ownerId",u.username,v.model,v.year,v.trim,v.bio,v.image_id AS "imageId"
      FROM owner_vehicles v JOIN users u ON u.id=v.owner_id WHERE v.id=$1`,
      [req.params.id],
    );
    if (!rows.length) fail(404, "차량을 찾을 수 없어요.");
    const records = await db.query(
      `SELECT id,kind,title,content,mileage,cost,recorded_on::text AS date FROM vehicle_records WHERE vehicle_id=$1 ORDER BY recorded_on DESC,id DESC`,
      [req.params.id],
    );
    res.json({
      ...rows[0],
      ownerId: Number(rows[0].ownerId),
      records: records.rows,
    });
  });
  router.post("/garage/:id/records", auth, async (req, res) => {
    const {
      kind,
      title,
      content = "",
      date,
      mileage = null,
      cost = null,
    } = req.body ?? {};
    if (!["maintenance", "tuning", "parts"].includes(kind))
      fail(400, "기록 종류를 선택해주세요.");
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      fail(400, "올바른 날짜를 입력해주세요.");
    const values = [
      req.params.id,
      req.user.id,
      kind,
      text(title, 150),
      text(content, 2000, false),
      date,
      integer(mileage, 0, 2000000, true),
      integer(cost, 0, 2000000000, true),
    ];
    const { rows } = await db.query(
      `INSERT INTO vehicle_records(vehicle_id,kind,title,content,recorded_on,mileage,cost)
      SELECT id,$3,$4,$5,$6,$7,$8 FROM owner_vehicles WHERE id=$1 AND owner_id=$2 RETURNING id`,
      values,
    );
    if (!rows.length) fail(403, "본인 차량에만 기록을 추가할 수 있어요.");
    res.status(201).json(rows[0]);
  });
  router.delete("/garage/:id/records/:recordId", auth, async (req, res) => {
    const { rowCount } = await db.query(
      `DELETE FROM vehicle_records r USING owner_vehicles v WHERE r.vehicle_id=v.id AND v.owner_id=$1 AND v.id=$2 AND r.id=$3`,
      [req.user.id, req.params.id, req.params.recordId],
    );
    if (!rowCount) fail(403, "본인 차량의 기록만 삭제할 수 있어요.");
    res.json({ ok: true });
  });
  return router;
}
