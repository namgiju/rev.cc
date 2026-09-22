import { Router } from "express";
import { fail, text, positive } from "./validation.js";
import { VERIFIED_OWNER_BADGE } from "./badges.js";

// Operational queries live beside the board tables; Spring retains vehicle verification.
export function adminRouter({ db, auth }) {
  const router = Router();
  router.use(auth, async (req, res, next) => {
    if (req.user.role !== "ADMIN") fail(403, "관리자만 접근할 수 있습니다.");
    const { rows } = await db.query("SELECT role FROM users WHERE id=$1", [
      req.user.id,
    ]);
    if (rows[0]?.role !== "ADMIN") fail(403, "관리자만 접근할 수 있습니다.");
    next();
  });
  const filters = (req) => {
    const q = text(req.query.q ?? "", 100, false);
    return {
      q: `%${q.replace(/[\\%_]/g, "\\$&")}%`,
      page: positive(req.query.page ?? 1),
    };
  };
  async function list(res, select, where, values, page) {
    // Keep count and page rows consistent, including an empty/out-of-range page.
    const { rows } = await db.query(
      `WITH filtered AS (${select} ${where})
      SELECT (SELECT count(*)::int FROM filtered) AS total,
      COALESCE((SELECT json_agg(item) FROM (SELECT * FROM filtered ORDER BY id DESC LIMIT 20 OFFSET $${values.length + 1}) item),'[]'::json) AS items`,
      [...values, (page - 1) * 20],
    );
    res.json({ ...rows[0], page, pageSize: 20 });
  }
  router.get("/overview", async (req, res) => {
    const { rows } =
      await db.query(`SELECT (SELECT count(*)::int FROM board_posts) AS "totalPosts",
      (SELECT count(*)::int FROM community_reports WHERE status='pending') AS "pendingReports"`);
    res.json(rows[0]);
  });
  router.get("/members", async (req, res) => {
    const { q, page } = filters(req);
    await list(
      res,
      `SELECT u.id,u.username,u.role,u.created_at AS "joinedAt",
      (SELECT count(*)::int FROM board_posts WHERE author_id=u.id) AS "postCount",
      (SELECT count(*)::int FROM owner_vehicles WHERE owner_id=u.id) AS "vehicleCount"
      FROM users u`,
      "WHERE u.username ILIKE $1",
      [q],
      page,
    );
  });
  router.get("/posts", async (req, res) => {
    const { q, page } = filters(req),
      category = text(req.query.category ?? "", 20, false);
    if (!["", "free", "maintenance", "parts", "drive"].includes(category))
      fail(400, "게시판을 확인해주세요.");
    await list(
      res,
      `SELECT p.id,p.title,p.category,p.author_id AS "authorId",u.username,p.created_at AS "createdAt",
      (SELECT count(*)::int FROM community_reports WHERE post_id=p.id) AS "reportCount"
      FROM board_posts p JOIN users u ON u.id=p.author_id`,
      "WHERE (p.title ILIKE $1 OR u.username ILIKE $1) AND ($2='' OR p.category=$2)",
      [q, category],
      page,
    );
  });
  router.get("/reports", async (req, res) => {
    const { q, page } = filters(req),
      status = text(req.query.status ?? "", 20, false);
    if (!["", "pending", "resolved", "dismissed"].includes(status))
      fail(400, "신고 상태를 확인해주세요.");
    await list(
      res,
      `SELECT r.id,r.post_id AS "postId",p.title,p.category,u.username AS reporter,r.reason,r.status,
      r.created_at AS "createdAt",r.reviewed_at AS "reviewedAt",a.username AS reviewer,r.resolution_note AS "resolutionNote"
      FROM community_reports r JOIN board_posts p ON p.id=r.post_id JOIN users u ON u.id=r.user_id
      LEFT JOIN users a ON a.id=r.reviewed_by`,
      "WHERE (p.title ILIKE $1 OR u.username ILIKE $1 OR r.reason ILIKE $1) AND ($2='' OR r.status=$2)",
      [q, status],
      page,
    );
  });
  router.patch("/reports/:id", async (req, res) => {
    const id = positive(req.params.id),
      status = req.body?.status,
      note = text(req.body?.note, 500);
    if (!["resolved", "dismissed"].includes(status))
      fail(400, "처리 결과를 선택해주세요.");
    const { rows } = await db.query(
      `UPDATE community_reports SET status=$2,resolution_note=$3,reviewed_by=$4,reviewed_at=NOW()
      WHERE id=$1 AND status='pending' RETURNING id,status,reviewed_at AS "reviewedAt"`,
      [id, status, note, req.user.id],
    );
    if (!rows.length) {
      const found = await db.query(
        "SELECT id FROM community_reports WHERE id=$1",
        [id],
      );
      if (!found.rows.length) fail(404, "신고를 찾을 수 없습니다.");
      fail(409, "이미 처리된 신고입니다. 목록을 새로고침해주세요.");
    }
    res.json(rows[0]);
  });
  router.get("/badges", async (req, res) => {
    const { rows } = await db.query(
      "SELECT count(DISTINCT owner_id)::int AS holders FROM owner_vehicles WHERE verified=true",
    );
    res.json([{ ...VERIFIED_OWNER_BADGE, holders: rows[0].holders }]);
  });
  return router;
}
