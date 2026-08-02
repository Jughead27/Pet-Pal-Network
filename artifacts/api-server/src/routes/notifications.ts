import { Router, type IRouter } from "express";
import { db, notificationsTable, petsTable } from "@workspace/db";
import { eq, isNull, and, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /notifications
 *
 * Returns the viewer's notifications (most recent first, capped at 50).
 * Currently only surfaces pet_tagged events (cross-owner pet tagging).
 * Each entry is enriched with petName and actorUsername for display.
 */
router.get("/notifications", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  const rows = await db
    .select({
      id:            notificationsTable.id,
      type:          notificationsTable.type,
      postId:        notificationsTable.postId,
      petId:         notificationsTable.petId,
      actorUserId:   notificationsTable.actorUserId,
      createdAt:     notificationsTable.createdAt,
      readAt:        notificationsTable.readAt,
      petName:       petsTable.name,
      actorUsername: sql<string | null>`(
        SELECT u.username FROM users u
        WHERE u.id = ${notificationsTable.actorUserId}
        LIMIT 1
      )`,
    })
    .from(notificationsTable)
    .leftJoin(petsTable, eq(petsTable.id, notificationsTable.petId))
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  const unreadCount = rows.filter((r) => r.readAt === null).length;

  res.json({
    notifications: rows.map((r) => ({
      id:            r.id,
      type:          r.type,
      postId:        r.postId        ?? null,
      petId:         r.petId         ?? null,
      petName:       r.petName       ?? null,
      actorUsername: r.actorUsername ?? null,
      createdAt:     r.createdAt,
      readAt:        r.readAt        ?? null,
    })),
    unreadCount,
  });
});

/**
 * PATCH /notifications/read-all
 * Marks all of the viewer's unread notifications as read.
 */
router.patch("/notifications/read-all", async (req, res) => {
  const userId = (req as unknown as { auth: { userId: string } }).auth.userId;

  await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.userId, userId),
        isNull(notificationsTable.readAt),
      ),
    );

  res.status(204).end();
});

export default router;
