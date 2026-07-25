import { Router, type IRouter } from "express";
import { db, commentsTable, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /posts/:id/comments
 *
 * Returns all comments on a post, ordered oldest-first, with the author's
 * username joined from the users table.
 */
router.get("/posts/:id/comments", async (req, res) => {
  const { id } = req.params;

  const rows = await db
    .select({
      id: commentsTable.id,
      text: commentsTable.text,
      authorUsername: usersTable.username,
      createdAt: commentsTable.createdAt,
    })
    .from(commentsTable)
    .innerJoin(usersTable, eq(usersTable.id, commentsTable.userId))
    .where(eq(commentsTable.postId, id))
    .orderBy(asc(commentsTable.createdAt));

  res.json(rows);
});

export default router;
