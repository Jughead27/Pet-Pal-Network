/**
 * ACCOUNT DELETION
 *
 * ★ APP-STORE-CRITICAL: Apple requires in-app account deletion and reviewers
 * exercise it manually. Regressions here are high priority.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, usersTable, petsTable, postsTable, petOwnersTable } from "@workspace/db";
import { asUser } from "./helpers/harness.js";
import {
  createTestUser,
  createTestPet,
  createTestPost,
  addCoOwner,
} from "./helpers/factories.js";

describe("[APP-STORE-CRITICAL] POST /me/delete", () => {
  it("soft-deletes solo pets with primary reassignment via the shared helper", async () => {
    const user = await createTestUser();
    const soloPet = await createTestPet(user.id);
    const otherPet = await createTestPet(user.id);
    // multi-pet post primary=soloPet, tagged otherPet... but otherPet is also
    // solo-owned by the same user, so it dies too. Use a co-owned survivor:
    const survivor = await createTestUser();
    await addCoOwner(otherPet.id, survivor.id);
    const multi = await createTestPost(user.id, [soloPet.id, otherPet.id]);

    const res = await asUser(user.id).post("/me/delete").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    const [soloRow] = await db.select().from(petsTable).where(eq(petsTable.id, soloPet.id));
    expect(soloRow.deletedAt).not.toBeNull();
    // otherPet survives (co-owned) and the multi post's primary reassigned to it
    const [otherRow] = await db.select().from(petsTable).where(eq(petsTable.id, otherPet.id));
    expect(otherRow.deletedAt).toBeNull();
    const [postRow] = await db.select().from(postsTable).where(eq(postsTable.id, multi.id));
    expect(postRow.petId).toBe(otherPet.id);
  });

  it("co-owned pets survive; primary ownership repoints to earliest surviving co-owner", async () => {
    const user = await createTestUser();
    const early = await createTestUser();
    const late = await createTestUser();
    const pet = await createTestPet(user.id); // user is primary
    await addCoOwner(pet.id, early.id, new Date(Date.now() - 2_000));
    await addCoOwner(pet.id, late.id, new Date(Date.now() - 1_000));

    const res = await asUser(user.id).post("/me/delete").send({});
    expect(res.status).toBe(200);

    const [petRow] = await db.select().from(petsTable).where(eq(petsTable.id, pet.id));
    expect(petRow.deletedAt).toBeNull();
    expect(petRow.ownerId).toBe(early.id); // earliest surviving co-owner

    const owners = await db.select().from(petOwnersTable).where(eq(petOwnersTable.petId, pet.id));
    expect(owners.map((o) => o.userId).sort()).toEqual([early.id, late.id].sort());
  });

  it("tombstones the user and locks them out immediately", async () => {
    const user = await createTestUser();
    const res = await asUser(user.id).post("/me/delete").send({});
    expect(res.status).toBe(200);

    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(row.deletedAt).not.toBeNull();
    expect(row.username).toBeNull();

    const locked = await asUser(user.id).get("/me");
    expect(locked.status).toBe(403);
    expect(locked.body).toMatchObject({ error: "account_deleted" });
  });
});
