/**
 * MERGE SUGGESTIONS — submission rules, rate limit, and the real merge
 * endpoint (re-tagging, dedupe, primary reassignment, soft-delete,
 * write-guard trigger).
 */
import { describe, expect, it } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  petsTable,
  postsTable,
  postPetsTable,
  packFollowsTable,
  petOwnersTable,
  mergeSuggestionsTable,
} from "@workspace/db";
import { asUser } from "./helpers/harness.js";
import {
  createTestUser,
  createTestPet,
  createTestPost,
  createPackFollow,
  createMergeSuggestion,
  addCoOwner,
} from "./helpers/factories.js";

describe("POST /merge-suggestions", () => {
  it("rejects when the suggester owns or co-owns the target", async () => {
    const user = await createTestUser();
    const mine = await createTestPet(user.id);
    const alsoMine = await createTestPet(user.id);
    const res = await asUser(user.id)
      .post("/merge-suggestions")
      .send({ suggesterPetId: mine.id, targetPetId: alsoMine.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already share/);

    // co-ownership also counts
    const other = await createTestUser();
    const theirs = await createTestPet(other.id);
    await addCoOwner(theirs.id, user.id);
    const res2 = await asUser(user.id)
      .post("/merge-suggestions")
      .send({ suggesterPetId: mine.id, targetPetId: theirs.id });
    expect(res2.status).toBe(400);
  });

  it("enforces the 10/day rate limit", async () => {
    const user = await createTestUser();
    const mine = await createTestPet(user.id);
    const other = await createTestUser();
    for (let i = 0; i < 10; i++) {
      const target = await createTestPet(other.id);
      const res = await asUser(user.id)
        .post("/merge-suggestions")
        .send({ suggesterPetId: mine.id, targetPetId: target.id });
      expect(res.status).toBe(201);
    }
    const target11 = await createTestPet(other.id);
    const limited = await asUser(user.id)
      .post("/merge-suggestions")
      .send({ suggesterPetId: mine.id, targetPetId: target11.id });
    expect(limited.status).toBe(429);
  });
});

describe("POST /admin/merge-suggestions/:id/merge", () => {
  async function buildScenario() {
    const admin = await createTestUser({ role: "admin" });
    const ownerA = await createTestUser();
    const ownerB = await createTestUser();
    const petA = await createTestPet(ownerA.id, { name: "Survivor" });
    const petB = await createTestPet(ownerB.id, { name: "Merged" });

    // p1: only B → tag + primary move to A
    const p1 = await createTestPost(ownerB.id, [petB.id]);
    // p2: tagged A and B, primary A → B's tag is a duplicate, deleted not moved
    const p2 = await createTestPost(ownerA.id, [petA.id, petB.id]);

    // followers: f1 follows only B (moves); f2 follows both (deduped)
    const f1 = await createTestUser();
    const f2 = await createTestUser();
    await createPackFollow(f1.id, petB.id);
    await createPackFollow(f2.id, petA.id);
    await createPackFollow(f2.id, petB.id);

    // the suggestion's pair IS (petA, petB) — the merge endpoint only accepts
    // the suggested pair, in either orientation
    const suggestion = await createMergeSuggestion(ownerA.id, petA.id, petB.id);

    return { admin, ownerA, ownerB, petA, petB, p1, p2, f1, f2, suggestion };
  }

  it("re-tags posts, dedupes followers/co-owners, reassigns primaries, soft-deletes merged pet", async () => {
    const s = await buildScenario();
    const res = await asUser(s.admin.id)
      .post(`/admin/merge-suggestions/${s.suggestion.id}/merge`)
      .send({ survivorPetId: s.petA.id, mergedPetId: s.petB.id });
    expect(res.status).toBe(200);
    expect(res.body.moved).toMatchObject({
      postsRetagged: 1,      // p1's tag; p2's duplicate tag deleted instead
      followersMoved: 1,     // f1; f2 deduped
      coOwnersMoved: 1,      // ownerB gains co-ownership of A
    });

    // p1 fully moved
    const [p1Row] = await db.select().from(postsTable).where(eq(postsTable.id, s.p1.id));
    expect(p1Row.petId).toBe(s.petA.id);
    // no tags reference B anywhere anymore
    const bTags = await db.select().from(postPetsTable).where(eq(postPetsTable.petId, s.petB.id));
    expect(bTags).toHaveLength(0);
    // p2 has exactly one tag for A (no duplicate)
    const p2Tags = await db.select().from(postPetsTable).where(
      and(eq(postPetsTable.postId, s.p2.id), eq(postPetsTable.petId, s.petA.id)),
    );
    expect(p2Tags).toHaveLength(1);
    // followers of A = f1 + f2, exactly once each
    const aFollows = await db.select().from(packFollowsTable)
      .where(eq(packFollowsTable.petId, s.petA.id));
    expect(aFollows.map((f) => f.userId).sort()).toEqual([s.f1.id, s.f2.id].sort());
    // owners of A = ownerA + ownerB
    const aOwners = await db.select().from(petOwnersTable)
      .where(eq(petOwnersTable.petId, s.petA.id));
    expect(aOwners.map((o) => o.userId).sort()).toEqual([s.ownerA.id, s.ownerB.id].sort());
    // B soft-deleted, suggestion actioned, audit row written
    const [bRow] = await db.select().from(petsTable).where(eq(petsTable.id, s.petB.id));
    expect(bRow.deletedAt).not.toBeNull();
    const [sug] = await db.select().from(mergeSuggestionsTable)
      .where(eq(mergeSuggestionsTable.id, s.suggestion.id));
    expect(sug.status).toBe("actioned");
    const audit = await db.execute(sql`
      SELECT 1 FROM audit_log
      WHERE action = 'merge_suggestion.merge' AND actor_id = ${s.admin.id}
    `);
    expect(audit.rows.length).toBe(1);
  });

  it("write-guard trigger rejects new rows referencing the soft-deleted pet", async () => {
    const s = await buildScenario();
    const res = await asUser(s.admin.id)
      .post(`/admin/merge-suggestions/${s.suggestion.id}/merge`)
      .send({ survivorPetId: s.petA.id, mergedPetId: s.petB.id });
    expect(res.status).toBe(200);

    const lateFollower = await createTestUser();
    // run inside a route-style transaction so the failed statement rolls back
    // to a savepoint instead of aborting the outer test transaction
    let err: unknown;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO pack_follows (user_id, pet_id)
          VALUES (${lateFollower.id}, ${s.petB.id})
        `);
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    // drizzle wraps the pg error; the trigger's message is on the cause chain
    const messages = [
      (err as Error).message,
      ((err as Error).cause as Error | undefined)?.message ?? "",
    ].join(" | ");
    expect(messages).toMatch(/deleted/);
  });
});
