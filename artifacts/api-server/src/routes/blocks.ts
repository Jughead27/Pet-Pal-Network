import { Router, type IRouter } from "express";
import { db, blocksTable, usersTable } from "@workspace/db";
import { and, desc, eq, or } from "drizzle-orm";

const router: IRouter = Router();

/**
 * POST /blocks
 * Body: { blockedUserId: string }
 *
 * Block another user.  Symmetric effect — each side stops seeing the other's
 * content everywhere (feed, sniff, nursery, pet grids, comments).
 *
 * Idempotent: double-block returns 200 { ok: true, duplicate: true }.
 * Self-block returns 400.
 * Unknown target returns 404.
 */
router.post("/blocks", async (req, res) => {
  const viewerId = (req as Express.RequestWithAuth).auth!.userId;
  const { blockedUserId } = req.body as { blockedUserId?: string };

  if (!blockedUserId?.trim()) {
    res.status(400).json({ error: "blockedUserId is required" });
    return;
  }

  if (blockedUserId === viewerId) {
    res.status(400).json({ error: "cannot block yourself" });
    return;
  }

  // Confirm target exists
  const [target] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, blockedUserId));

  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Attempt insert — catch unique violation for idempotent double-block
  try {
    await db.insert(blocksTable).values({
      blockerId: viewerId,
      blockedId: blockedUserId,
    });
  } catch (err: unknown) {
    // PostgreSQL unique_violation = code 23505
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException & { code?: string }).code === "23505"
    ) {
      res.json({ ok: true, duplicate: true });
      return;
    }
    throw err;
  }

  res.json({ ok: true });
});

/**
 * DELETE /blocks/:blockedUserId
 *
 * Unblock a previously blocked user.  Idempotent — silently 204 if no
 * block exists (nothing to undo).
 */
router.delete("/blocks/:blockedUserId", async (req, res) => {
  const viewerId = (req as Express.RequestWithAuth).auth!.userId;
  const { blockedUserId } = req.params;

  await db
    .delete(blocksTable)
    .where(
      and(
        eq(blocksTable.blockerId, viewerId),
        eq(blocksTable.blockedId, blockedUserId),
      ),
    );

  res.status(204).send();
});

/**
 * GET /blocks
 *
 * Returns the list of users the authenticated viewer has blocked, with
 * usernames joined.  Used by the profile → "Blocked Owners" unblock list.
 */
router.get("/blocks", async (req, res) => {
  const viewerId = (req as Express.RequestWithAuth).auth!.userId;

  const rows = await db
    .select({
      userId:    blocksTable.blockedId,
      username:  usersTable.username,
      blockedAt: blocksTable.createdAt,
    })
    .from(blocksTable)
    .innerJoin(usersTable, eq(usersTable.id, blocksTable.blockedId))
    .where(eq(blocksTable.blockerId, viewerId))
    .orderBy(desc(blocksTable.createdAt));

  res.json({ blocks: rows });
});

export default router;
