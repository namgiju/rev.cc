import { deleteContent } from './moderation.js';
import { displayNameSql, isWithdrawnSql, publicMemberId, unlessWithdrawnSql } from "./member-display.js";
import { existingImageIdsSql, publicImageSql } from "./image-references.js";
import { Router } from "express";
import { VERIFIED_OWNER_BADGE } from "./badges.js";

import { fail, text, positive, integer } from "./validation.js";
import { validateOwnedImages } from "./owned-images.js";
import { rateLimiter } from "./rate-limit.js";

const categories = ["free", "maintenance", "parts", "drive"];
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
// 탈퇴 작성자의 글은 남기되 이름·회원 id·차량(차고 링크로 다시 식별된다)은 공개하지 않는다(member-display.js).
const postSelect = `SELECT p.id,p.title,p.content,${unlessWithdrawnSql("u", "p.author_id")} AS "authorId",${displayNameSql("u")} AS username,
 ${isWithdrawnSql("u")} AS "authorWithdrawn",
 ${unlessWithdrawnSql("u", "p.vehicle_id")} AS "vehicleId",
 ${unlessWithdrawnSql("u", "(SELECT json_build_object('id',v.id,'model',v.model,'year',v.year,'verified',v.verified,'imageId',v.image_id) FROM owner_vehicles v WHERE v.id=p.vehicle_id AND v.owner_id=p.author_id)")} AS "linkedVehicle",
 p.created_at AS "createdAt",p.updated_at AS "updatedAt",p.category,p.vehicle,${existingImageIdsSql("p.image_ids")} AS "imageIds",p.views,
 (SELECT COUNT(*)::int FROM board_comments c WHERE c.post_id=p.id AND NOT c.deleted) AS "commentCount",
 (SELECT COUNT(*)::int FROM board_likes l WHERE l.post_id=p.id) AS "likeCount",
 EXISTS(SELECT 1 FROM board_likes l WHERE l.post_id=p.id AND l.user_id=$1) AS liked,
 EXISTS(SELECT 1 FROM board_bookmarks b WHERE b.post_id=p.id AND b.user_id=$1) AS bookmarked,
 ${unlessWithdrawnSql("u", "(SELECT model FROM owner_vehicles v WHERE v.owner_id=p.author_id ORDER BY v.id LIMIT 1)")} AS "ownerVehicle"
 FROM (SELECT * FROM board_posts WHERE NOT deleted) p JOIN users u ON u.id=p.author_id`;
const asPost = (row) => ({ ...row, authorId: publicMemberId(row.authorId) });

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
// period=week: 지금부터 최근 7일(rolling)을 되돌아본 시각. "이번 주 인기 이야기"에서 사용한다.
function weekAgo() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

export function communityRouter({ db, auth }) {
  const router = Router();
  // 스팸/스토리지 고갈을 막는 기본적인 계정당 rate limit. 정상적인 글쓰기/댓글 흐름은
  // 넉넉히 통과하도록 여유 있게 잡았다.
  const postLimiter = rateLimiter({ windowMs: 60_000, max: 10, message: "글 작성이 너무 잦아요. 잠시 후 다시 시도해주세요." });
  const commentLimiter = rateLimiter({ windowMs: 60_000, max: 20, message: "댓글 작성이 너무 잦아요. 잠시 후 다시 시도해주세요." });
  const guestbookLimiter = rateLimiter({ windowMs: 60_000, max: 10, message: "방명록 작성이 너무 잦아요. 잠시 후 다시 시도해주세요." });
  const imageLimiter = rateLimiter({ windowMs: 60_000, max: 20, message: "사진 업로드가 너무 잦아요. 잠시 후 다시 시도해주세요." });
  const reportLimiter = rateLimiter({ windowMs: 60_000, max: 10, message: "신고가 너무 잦아요. 잠시 후 다시 시도해주세요." });
  // 조회수는 비로그인도 올릴 수 있어 로그인 여부와 관계없이 IP 단위로 제한한다(조회수 부풀리기 방지).
  const viewLimiter = rateLimiter({ windowMs: 60_000, max: 60, by: "ip" });
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
      "SELECT id,author_id FROM board_posts WHERE id=$1 AND NOT deleted",
      [id],
    );
    if (!rows.length) fail(404, "삭제되었거나 없는 글입니다.");
    return rows[0];
  };
  const images = (ids, userId) => validateOwnedImages(db, ids, userId);
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
    let linked = null;
    if (body?.vehicleId != null && body.vehicleId !== "") {
      const { rows } = await db.query(
        "SELECT id,model FROM owner_vehicles WHERE id=$1 AND owner_id=$2",
        [positive(body.vehicleId), userId],
      );
      if (!rows.length) fail(403, "본인 차량만 연결할 수 있어요.");
      linked = rows[0];
    }
    return [
      text(title, 150),
      text(content, 5000),
      userId,
      category,
      linked ? linked.model : text(vehicle, 100, false),
      await images(imageIds, userId),
      linked?.id ?? null,
    ];
  }
  router.post("/images", auth, imageLimiter, async (req, res) => {
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
    // 공개 데이터가 참조하는 사진만 누구에게나 준다(image-references.js). 소유자는 작성 중 미리보기로,
    // 관리자(DB 기준 역할)는 신고 처리로 볼 수 있다. 정지·탈퇴 세션은 app.js 인증에서 이미 null이다.
    // 삭제된 글에만 쓰였거나 어디에도 쓰이지 않는 사진은 id를 알아도 404로, 없는 사진과 구분하지 않는다.
    const { rows } = await db.query(
      `SELECT i.mime,i.data FROM community_images i WHERE i.id=$1 AND (
        i.owner_id=$2 OR EXISTS(SELECT 1 FROM users a WHERE a.id=$2 AND a.role='ADMIN') OR ${publicImageSql("i")})`,
      [req.params.id, req.user?.id ?? null],
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
    if (period && !["today", "week"].includes(period))
      fail(400, "지원하지 않는 기간입니다.");
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
      period === "today" ? todayStartKst() : period === "week" ? weekAgo() : null,
    ];
    // 작성자 검색은 화면에 보이는 이름으로만 한다(탈퇴 회원의 원래 아이디로 글을 찾을 수 없게).
    let where = ` WHERE (p.title ILIKE $2 OR p.content ILIKE $2 OR ${displayNameSql("u")} ILIKE $2) AND ($3='' OR p.category=$3) AND p.vehicle ILIKE $4 AND ($5::timestamptz IS NULL OR p.created_at>=$5)`;
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
  router.post("/posts", auth, postLimiter, async (req, res) => {
    const values = await postInput(req.body, req.user.id);
    const { rows } = await db.query(
      `INSERT INTO board_posts(title,content,author_id,category,vehicle,image_ids,vehicle_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,title,content,category,author_id AS "authorId"`,
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
  router.post("/posts/:id/view", viewLimiter, async (req, res) => {
    const { rows } = await db.query(
      "UPDATE board_posts SET views=views+1 WHERE id=$1 AND NOT deleted RETURNING views",
      [req.params.id],
    );
    if (!rows.length) fail(404, "삭제되었거나 없는 글입니다.");
    res.json(rows[0]);
  });
  router.put("/posts/:id", auth, async (req, res) => {
    const values = await postInput(req.body, req.user.id);
    const { rows } = await db.query(
      `UPDATE board_posts SET title=$1,content=$2,category=$4,
      vehicle=CASE WHEN NOT $9 AND vehicle_id IS NOT NULL THEN vehicle ELSE $5 END,
      image_ids=$6,vehicle_id=CASE WHEN $9 THEN $7 ELSE vehicle_id END,updated_at=NOW()
      WHERE id=$8 AND author_id=$3 AND NOT deleted RETURNING id,category`,
      [...values, req.params.id, Object.hasOwn(req.body ?? {}, "vehicleId")],
    );
    if (!rows.length) fail(403, "본인이 작성한 글만 수정할 수 있어요.");
    res.json(rows[0]);
  });
  router.delete("/posts/:id", auth, async (req, res) => {
    await deleteContent(db, req.user, 'post', req.params.id, req.body?.reason);
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
      `SELECT c.id,c.content,c.deleted,c.parent_id AS "parentId",${unlessWithdrawnSql("u", "c.author_id")} AS "authorId",
      ${displayNameSql("u")} AS username,${isWithdrawnSql("u")} AS "authorWithdrawn",c.created_at AS "createdAt"
      FROM board_comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=$1 ORDER BY c.id`,
      [req.params.id],
    );
    res.json(rows.map((c) => ({ ...c, authorId: publicMemberId(c.authorId) })));
  });
  router.post("/posts/:id/comments", auth, commentLimiter, async (req, res) => {
    const content = text(req.body?.content, 2000);
    const parent =
      req.body?.parentId == null ? null : positive(req.body.parentId);
    // Insert, parent validation and notification are one atomic statement.
    const { rows } = await db.query(
      `WITH target AS (
      SELECT p.id,p.author_id,pc.author_id AS parent_author FROM board_posts p
      LEFT JOIN board_comments pc ON pc.id=$4 AND pc.post_id=p.id AND pc.parent_id IS NULL AND NOT pc.deleted
      WHERE p.id=$1 AND NOT p.deleted AND ($4::int IS NULL OR pc.id IS NOT NULL)
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
    await deleteContent(db, req.user, 'comment', req.params.commentId, req.body?.reason);
    res.json({ ok: true });
  });
  router.post("/posts/:id/report", auth, reportLimiter, async (req, res) => {
    await exists(req.params.id);
    const reason = text(req.body?.reason, 500);
    const { rows } = await db.query(
      `INSERT INTO community_reports(user_id,post_id,reason) VALUES($1,$2,$3)
      ON CONFLICT(user_id,post_id) DO UPDATE SET reason=EXCLUDED.reason WHERE community_reports.status='pending' RETURNING id`,
      [req.user.id, req.params.id, reason],
    );
    if (!rows.length) fail(409, "이미 처리된 신고입니다.");
    res.status(201).json(rows[0]);
  });
  router.get("/reports", auth, async (req, res) => {
    const { rows } = await db.query(
      `SELECT r.id,r.reason,r.status,r.created_at AS "createdAt",p.id AS "postId",p.title,p.category
      FROM community_reports r JOIN board_posts p ON p.id=r.post_id WHERE r.user_id=$1 AND NOT p.deleted ORDER BY r.id DESC LIMIT 100`,
      [req.user.id],
    );
    res.json(rows);
  });
  router.get("/notifications", auth, async (req, res) => {
    const { rows } = await db.query(
      `SELECT n.id,n.post_id AS "postId",n.is_read AS "isRead",n.created_at AS "createdAt",p.title,p.category,${displayNameSql("u")} AS username,n.kind
      FROM community_notifications n JOIN board_posts p ON p.id=n.post_id JOIN users u ON u.id=n.actor_id
      WHERE n.user_id=$1 AND NOT p.deleted ORDER BY n.id DESC LIMIT 100`,
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
  // Personal settings are always bound to the shared session, never to role or body.userId.
  router.put("/profile", auth, async (req, res) => {
    const bio = text(req.body?.bio, 300, false);
    const avatar = req.body?.avatarImageId == null ? null : positive(req.body.avatarImageId);
    const cover = req.body?.coverImageId == null ? null : positive(req.body.coverImageId);
    await images([avatar, cover].filter(Boolean), req.user.id);
    await db.query(`INSERT INTO member_profiles(user_id,bio,avatar_image_id,cover_image_id)
      VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE
      SET bio=EXCLUDED.bio,avatar_image_id=EXCLUDED.avatar_image_id,cover_image_id=EXCLUDED.cover_image_id`,
      [req.user.id, bio, avatar, cover]);
    res.json({ok:true});
  });
  router.put("/profile/representative-vehicle", auth, async (req, res) => {
    const id = positive(req.body?.vehicleId);
    const {rowCount} = await db.query(`INSERT INTO member_profiles(user_id,representative_vehicle_id)
      SELECT owner_id,id FROM owner_vehicles WHERE id=$1 AND owner_id=$2
      ON CONFLICT(user_id) DO UPDATE SET representative_vehicle_id=EXCLUDED.representative_vehicle_id`, [id,req.user.id]);
    if (!rowCount) fail(403, "본인 차량만 대표 차량으로 설정할 수 있어요.");
    res.json({ok:true});
  });
  router.get("/members/:id/guestbook", async (req, res) => {
    const before = req.query.before === undefined ? null : positive(req.query.before);
    // 탈퇴 회원의 차고(와 그 방명록)는 공개하지 않는다. 다른 회원 차고에 남긴 방명록은 "탈퇴한 회원"으로 보인다.
    const owner = await db.query(`SELECT id,(SELECT COUNT(*)::int FROM garage_guestbook WHERE owner_id=$1) AS total FROM users u WHERE id=$1 AND NOT ${isWithdrawnSql("u")}`,[req.params.id]);
    if (!owner.rows.length) fail(404, "회원을 찾을 수 없어요.");
    const {rows} = await db.query(`SELECT g.id,g.owner_id AS "ownerId",${unlessWithdrawnSql("u", "g.author_id")} AS "authorId",
      ${displayNameSql("u")} AS username,${isWithdrawnSql("u")} AS "authorWithdrawn",g.content,g.created_at AS "createdAt"
      FROM garage_guestbook g JOIN users u ON u.id=g.author_id
      WHERE g.owner_id=$1 AND ($2::int IS NULL OR g.id<$2) ORDER BY g.id DESC LIMIT 21`,[req.params.id,before]);
    const items=rows.slice(0,20).map(r=>({...r,ownerId:Number(r.ownerId),authorId:publicMemberId(r.authorId)}));
    res.json({items,total:owner.rows[0].total,nextCursor:rows.length>20?items.at(-1).id:null});
  });
  router.post("/members/:id/guestbook", auth, guestbookLimiter, async (req, res) => {
    const content = text(req.body?.content,1000);
    const {rows} = await db.query(`INSERT INTO garage_guestbook(owner_id,author_id,content)
      SELECT id,$2,$3 FROM users u WHERE id=$1 AND NOT ${isWithdrawnSql("u")} RETURNING id`,[req.params.id,req.user.id,content]);
    if (!rows.length) fail(404,"회원을 찾을 수 없어요.");
    res.status(201).json(rows[0]);
  });
  router.delete("/members/:id/guestbook/:entryId", auth, async (req, res) => {
    const {rowCount} = await db.query(`DELETE FROM garage_guestbook WHERE id=$1 AND owner_id=$2 AND (author_id=$3 OR owner_id=$3)`,[positive(req.params.entryId),req.params.id,req.user.id]);
    if (!rowCount) fail(403,"작성자 또는 방명록 주인만 삭제할 수 있어요.");
    res.json({ok:true});
  });
  router.get("/members/:id", async (req, res) => {
    const { rows } = await db.query(
      `SELECT u.id,u.username,u.created_at AS "joinedAt",
       (SELECT COUNT(*)::int FROM board_posts p WHERE p.author_id=u.id AND NOT p.deleted) AS "postCount",
       (SELECT COUNT(*)::int FROM board_comments c WHERE c.author_id=u.id AND NOT c.deleted AND EXISTS(SELECT 1 FROM board_posts p WHERE p.id=c.post_id AND NOT p.deleted)) AS "commentCount",
       (SELECT COUNT(*)::int FROM board_likes l JOIN board_posts p ON p.id=l.post_id WHERE p.author_id=u.id AND NOT p.deleted) AS "receivedLikes"
       FROM users u WHERE u.id=$1 AND NOT ${isWithdrawnSql("u")}`,
      [req.params.id],
    );
    // 탈퇴 회원의 공개 프로필(가입일·활동 수·차고·프로필 사진)은 보여 주지 않는다.
    if (!rows.length) fail(404, "회원을 찾을 수 없어요.");
    const posts = await db.query(
      postSelect + " WHERE p.author_id=$2 ORDER BY p.id DESC LIMIT 30",
      [req.user?.id ?? null, req.params.id],
    );
    // 공개 프로필에는 등록증·차량번호·심사 정보를 포함하지 않는다.
    const vehicles = await db.query(
      `SELECT id,manufacturer,model,year,trim,nickname,image_id AS "imageId",verified
       FROM owner_vehicles WHERE owner_id=$1 ORDER BY verified DESC,id ASC`,
      [req.params.id],
    );
    const settings = (await db.query(`SELECT bio,avatar_image_id AS "avatarImageId",cover_image_id AS "coverImageId",
      representative_vehicle_id AS "representativeVehicleId" FROM member_profiles WHERE user_id=$1`,[req.params.id])).rows[0] || {};
    const verified = vehicles.rows.some((v) => v.verified);
    res.json({
      ...rows[0],
      id: Number(rows[0].id),
      ...settings,
      avatarUrl: settings.avatarImageId ? `/api/board/images/${settings.avatarImageId}` : null,
      vehicles: vehicles.rows,
      representativeVehicle: vehicles.rows.find(v=>v.id===settings.representativeVehicleId) ?? vehicles.rows[0] ?? null,
      verified,
      // 실제 인증 상태에서 계산하는 표시용 인장. 획득 이력은 생성하지 않는다.
      badges: verified ? [{ ...VERIFIED_OWNER_BADGE }] : [],
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
      WHERE NOT deleted AND vehicle IS NOT NULL AND vehicle<>'' GROUP BY vehicle
      ORDER BY "postCount" DESC, vehicle ASC LIMIT $1`,
      [limit],
    );
    res.json(rows);
  });
  // 홈 Hero 하단 서비스 지표. 실제 가입 회원/등록 차량/거래 완료 부품/게시글 수만 집계하며,
  // 이벤트 기능은 아직 없어 "커뮤니티 게시글"로 대체한다. 새 테이블이나 통계 시스템은 만들지 않는다.
  router.get("/stats/summary", async (req, res) => {
    const { rows } = await db.query(
      `SELECT
       (SELECT COUNT(*)::int FROM users u WHERE NOT ${isWithdrawnSql("u")}) AS "memberCount",
       (SELECT COUNT(*)::int FROM owner_vehicles) AS "vehicleCount",
       (SELECT COUNT(*)::int FROM parts_listings WHERE status='sold') AS "soldPartsCount",
       (SELECT COUNT(*)::int FROM board_posts WHERE NOT deleted) AS "postCount"`,
    );
    res.json(rows[0]);
  });
  // 홈 "REV.CC 인기 게시판" 전용 최소 집계. 4개 고정 카테고리(자유/정비/부품/드라이브)의
  // 게시글 수·최근 7일 게시글 수·누적 추천 수만 세며, 새로운 추천 시스템은 만들지 않는다.
  router.get("/categories/summary", async (req, res) => {
    const { rows } = await db.query(
      `SELECT c.category,
       COUNT(p.id)::int AS "postCount",
       COUNT(p.id) FILTER (WHERE p.created_at>=$1)::int AS "recentPostCount",
       COALESCE(SUM(pl.likes),0)::int AS "likeCount"
       FROM (VALUES ('free'),('maintenance'),('parts'),('drive')) AS c(category)
       LEFT JOIN board_posts p ON p.category=c.category AND NOT p.deleted
       LEFT JOIN (SELECT post_id, COUNT(*) AS likes FROM board_likes GROUP BY post_id) pl ON pl.post_id=p.id
       GROUP BY c.category
       ORDER BY "recentPostCount" DESC,"likeCount" DESC,"postCount" DESC`,
      [weekAgo()],
    );
    res.json(rows);
  });
  // Personal garage: identity comes only from the shared Redis session, including ADMIN.
  // Keep the public /garage?owner=... API for community member profiles.
  router.get("/garage/mine", auth, async (req, res) => {
    const { rows } = await db.query(
      `SELECT v.id,v.owner_id AS "ownerId",u.username,v.manufacturer,v.model,v.year,v.trim,v.bio,
       v.nickname,v.image_id AS "imageId",v.verified,v.verification_status AS "verificationStatus",
       (SELECT COUNT(*)::int FROM vehicle_records r WHERE r.vehicle_id=v.id) AS "recordCount"
       FROM owner_vehicles v JOIN users u ON u.id=v.owner_id
       WHERE v.owner_id=$1 ORDER BY v.id DESC`,
      [req.user.id],
    );
    res.json(rows.map((v) => ({ ...v, ownerId: Number(v.ownerId) })));
  });
  router.get("/garage", async (req, res) => {
    const owner =
      req.query.owner === undefined ? null : positive(req.query.owner);
    const { rows } = await db.query(
      `SELECT v.id,v.owner_id AS "ownerId",u.username,v.model,v.year,v.trim,v.bio,v.image_id AS "imageId",
      (SELECT COUNT(*)::int FROM vehicle_records r WHERE r.vehicle_id=v.id) AS "recordCount"
      FROM owner_vehicles v JOIN users u ON u.id=v.owner_id WHERE ($1::bigint IS NULL OR v.owner_id=$1) AND NOT ${isWithdrawnSql("u")} ORDER BY v.id DESC LIMIT 100`,
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
      FROM owner_vehicles v JOIN users u ON u.id=v.owner_id WHERE v.id=$1 AND NOT ${isWithdrawnSql("u")}`,
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
