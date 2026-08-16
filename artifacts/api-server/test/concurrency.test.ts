/**
 * CONCURRENCY SANITY — duplicate/burst submissions must not corrupt data.
 *
 * Scope note (matches the harness design): all requests share one dev-DB
 * connection inside the rollback transaction, and the harness serializes
 * every request's DB work onto that session. These tests therefore verify
 * SERIALIZED double-submission behavior — the second/third identical request
 * fails cleanly against the state the first one left, and the final state is
 * consistent — plus in-process limiter accuracy under a simultaneous burst.
 * They do NOT (and cannot, on one connection) exercise multi-connection lock
 * contention; that protection lives in the routes' FOR UPDATE locking and
 * the DB-level deleted-pet write-guard triggers, which merge-suggestions
 * tests cover directly.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, petsTable, postsTable, petOwnersTable, packFollowsTable } from "@workspace/db";
import { asUser } from "./helpers/harness.js";
import {
  createTestUser,
  createTestPet,
  createTestPost,
  createPackFollow,
  createMergeSuggestion,
  addCoOwner,
} from "./helpers/factories.js";

describe("concurrency sanity", () => {
  it("duplicate merge submissions of the same pair: exactly one succeeds, others fail cleanly, no partial state", async () => {
    const admin = await createTestUser({ role: "admin" });
    const ownerA = await createTestUser();
    const ownerB = await createTestUser();
    const petA = await createTestPet(ownerA.id);
    const petB = await createTestPet(ownerB.id);
    await createTestPost(ownerB.id, [petB.id]);
    const fan = await createTestUser();
    await createPackFollow(fan.id, petB.id);
    const suggestion = await createMergeSuggestion(ownerA.id, petA.id, petB.id);

    const results = await Promise.all(
      [0, 1, 2].map(() =>
        asUser(admin.id)
          .post(`/admin/merge-suggestions/${suggestion.id}/merge`)
          .send({ survivorPetId: petA.id, mergedPetId: petB.id }),
      ),
    );
    const detail = JSON.stringify(results.map((r) => ({ status: r.status, body: r.body, text: r.status === 500 ? r.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 500) : undefined })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200), detail).toHaveLength(1);
    // losers fail cleanly (suggestion no longer pending / pet no longer live)
    for (const s of statuses.filter((x) => x !== 200)) {
      expect([404, 409], detail).toContain(s);
    }

    // no partial/corrupted state
    const [bRow] = await db.select().from(petsTable).where(eq(petsTable.id, petB.id));
    expect(bRow.deletedAt).not.toBeNull();
    const aFollows = await db.select().from(packFollowsTable)
      .where(eq(packFollowsTable.petId, petA.id));
    expect(aFollows).toHaveLength(1); // fan moved exactly once
    const aOwners = await db.select().from(petOwnersTable)
      .where(eq(petOwnersTable.petId, petA.id));
    expect(aOwners.map((o) => o.userId).sort()).toEqual([ownerA.id, ownerB.id].sort());
  });

  it("duplicate pet deletions: single reassignment, no lost update", async () => {
    const owner = await createTestUser();
    const petA = await createTestPet(owner.id);
    const petB = await createTestPet(owner.id);
    const other = await createTestUser();
    await addCoOwner(petB.id, other.id); // keep B alive independently
    const post = await createTestPost(owner.id, [petA.id, petB.id]);

    const results = await Promise.all(
      [0, 1].map(() => asUser(owner.id).delete(`/pets/${petA.id}`)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 204)).toHaveLength(1);
    expect([403, 404, 409]).toContain(statuses.find((s) => s !== 204));

    const [postRow] = await db.select().from(postsTable).where(eq(postsTable.id, post.id));
    expect(postRow.petId).toBe(petB.id); // reassigned exactly once, not lost
    const [aRow] = await db.select().from(petsTable).where(eq(petsTable.id, petA.id));
    expect(aRow.deletedAt).not.toBeNull();
  });

  it("rate limiter counts accurately under a simultaneous burst", async () => {
    const user = await createTestUser();
    const results = await Promise.all(
      Array.from({ length: 40 }, () => asUser(user.id).post("/posts").send({})),
    );
    const counts = results.reduce<Record<number, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    // exactly the threshold (25) admitted past the limiter, never more
    expect(counts[400] ?? 0).toBe(25);
    expect(counts[429] ?? 0).toBe(15);
  });
});
