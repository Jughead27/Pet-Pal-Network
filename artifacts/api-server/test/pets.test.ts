/**
 * PETS — create/edit/delete, primary-owner enforcement, primary reassignment,
 * delete-impact preview parity with actual delete behavior.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, petsTable, postsTable, petOwnersTable } from "@workspace/db";
import { asUser } from "./helpers/harness.js";
import {
  createTestUser,
  createTestPet,
  createTestPost,
  addCoOwner,
} from "./helpers/factories.js";

describe("pets routes", () => {
  it("POST /pets creates a pet and its ownership row", async () => {
    const user = await createTestUser();
    const res = await asUser(user.id).post("/pets").send({ name: "Biscuit", species: "dog" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Biscuit");
    const owners = await db.select().from(petOwnersTable)
      .where(eq(petOwnersTable.petId, res.body.id));
    expect(owners.map((o) => o.userId)).toContain(user.id);
  });

  it("PATCH /pets/:id edits own pet; 403 for non-owner", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const pet = await createTestPet(owner.id);

    const ok = await asUser(owner.id).patch(`/pets/${pet.id}`).send({ name: "Renamed" });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("Renamed");

    const forbidden = await asUser(stranger.id).patch(`/pets/${pet.id}`).send({ name: "Nope" });
    expect(forbidden.status).toBe(403);
  });

  it("DELETE /pets/:id is primary-owner-only; happy path soft-deletes", async () => {
    const primary = await createTestUser();
    const coOwner = await createTestUser();
    const pet = await createTestPet(primary.id);
    await addCoOwner(pet.id, coOwner.id);

    const denied = await asUser(coOwner.id).delete(`/pets/${pet.id}`);
    expect(denied.status).toBe(403);

    const ok = await asUser(primary.id).delete(`/pets/${pet.id}`);
    expect(ok.status).toBe(204);
    const [row] = await db.select().from(petsTable).where(eq(petsTable.id, pet.id));
    expect(row.deletedAt).not.toBeNull();
  });

  it("delete reassigns primary to surviving tag; no surviving tag drops the post; preview matches", async () => {
    const owner = await createTestUser();
    const petA = await createTestPet(owner.id, { name: "Alpha" });
    const petB = await createTestPet(owner.id, { name: "Beta" });
    // multi-pet post: primary A, also tagged B → should reassign to B
    const multi = await createTestPost(owner.id, [petA.id, petB.id]);
    // solo post: only A → no surviving tag, drops out of public reads
    const solo = await createTestPost(owner.id, [petA.id]);

    const preview = await asUser(owner.id).get(`/pets/${petA.id}/delete-impact`);
    expect(preview.status).toBe(200);
    expect(preview.body.removedCount).toBe(1);
    expect(preview.body.reassigned).toEqual([
      expect.objectContaining({ petId: petB.id, count: 1 }),
    ]);

    const del = await asUser(owner.id).delete(`/pets/${petA.id}`);
    expect(del.status).toBe(204);

    // actual behavior matches the preview
    const [multiRow] = await db.select().from(postsTable).where(eq(postsTable.id, multi.id));
    expect(multiRow.petId).toBe(petB.id);
    const [soloRow] = await db.select().from(postsTable).where(eq(postsTable.id, solo.id));
    expect(soloRow.petId).toBe(petA.id); // untouched; hidden from public reads via activePets

    // solo post no longer publicly visible
    const feed = await asUser(owner.id).get(`/feed?petId=${petA.id}`);
    expect(feed.body.posts.map((p: { id: string }) => p.id)).not.toContain(solo.id);
  });
});
