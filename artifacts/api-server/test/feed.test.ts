/**
 * FEED — pagination, sorts, exclusions.
 *
 * The dev DB contains real committed rows, so tests scope the feed with the
 * petId filter (deterministic: only our transaction-local posts appear) and
 * make relative-order assertions where global ordering is involved.
 */
import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/harness.js";
import {
  createTestUser,
  createTestPet,
  createTestPost,
  createBoop,
} from "./helpers/factories.js";

describe("GET /feed", () => {
  it("paginates with correct page size and a cursor that never skips or duplicates", async () => {
    const owner = await createTestUser();
    const pet = await createTestPet(owner.id);
    const created: string[] = [];
    const base = Date.now();
    for (let i = 0; i < 12; i++) {
      const p = await createTestPost(owner.id, [pet.id], {
        createdAt: new Date(base - i * 1000),
      });
      created.push(p.id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await asUser(owner.id).get(
        `/feed?petId=${pet.id}&limit=5${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.posts.length).toBeLessThanOrEqual(5);
      seen.push(...res.body.posts.map((p: { id: string }) => p.id));
      cursor = res.body.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3); // 5 + 5 + 2
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12); // no duplicates
    expect(new Set(seen)).toEqual(new Set(created)); // no skips
    // Fresh sort = newest first
    expect(seen).toEqual(created);
  });

  it("rejects a malformed cursor", async () => {
    const owner = await createTestUser();
    const res = await asUser(owner.id).get("/feed?cursor=%25not-base64json");
    expect(res.status).toBe(400);
  });

  it("popular sort orders by engagement", async () => {
    const owner = await createTestUser();
    const pet = await createTestPet(owner.id);
    // quiet post is NEWER — under fresh sort it would come first, so popular
    // ordering is genuinely exercised.
    const popular = await createTestPost(owner.id, [pet.id], {
      createdAt: new Date(Date.now() - 60_000),
    });
    const quiet = await createTestPost(owner.id, [pet.id]);
    for (let i = 0; i < 3; i++) {
      const fan = await createTestUser();
      await createBoop(popular.id, fan.id);
    }

    const res = await asUser(owner.id).get(`/feed?petId=${pet.id}&sort=popular&limit=10`);
    expect(res.status).toBe(200);
    const ids = res.body.posts.map((p: { id: string }) => p.id);
    expect(ids.indexOf(popular.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(popular.id)).toBeLessThan(ids.indexOf(quiet.id));
  });

  it("nursery filter returns only nursery posts", async () => {
    const owner = await createTestUser();
    const pet = await createTestPet(owner.id);
    const nursery = await createTestPost(owner.id, [pet.id], { isNursery: true });
    const regular = await createTestPost(owner.id, [pet.id]);

    const res = await asUser(owner.id).get(`/feed?petId=${pet.id}&nursery=true`);
    expect(res.status).toBe(200);
    const ids = res.body.posts.map((p: { id: string }) => p.id);
    expect(ids).toContain(nursery.id);
    expect(ids).not.toContain(regular.id);
  });

  it("excludes posts from blocked owners (both directions)", async () => {
    const viewer = await createTestUser();
    const poster = await createTestUser();
    const pet = await createTestPet(poster.id);
    const post = await createTestPost(poster.id, [pet.id]);

    // sanity: visible before block
    const before = await asUser(viewer.id).get(`/feed?petId=${pet.id}`);
    expect(before.body.posts.map((p: { id: string }) => p.id)).toContain(post.id);

    const { createBlock } = await import("./helpers/factories.js");
    await createBlock(viewer.id, poster.id); // viewer blocked poster
    const blocked = await asUser(viewer.id).get(`/feed?petId=${pet.id}`);
    expect(blocked.body.posts.map((p: { id: string }) => p.id)).not.toContain(post.id);

    // other direction: poster blocked viewer2
    const viewer2 = await createTestUser();
    await createBlock(poster.id, viewer2.id);
    const blocked2 = await asUser(viewer2.id).get(`/feed?petId=${pet.id}`);
    expect(blocked2.body.posts.map((p: { id: string }) => p.id)).not.toContain(post.id);
  });

  it("excludes archived posts", async () => {
    const owner = await createTestUser();
    const viewer = await createTestUser();
    const pet = await createTestPet(owner.id);
    const live = await createTestPost(owner.id, [pet.id]);
    const archived = await createTestPost(owner.id, [pet.id], { archivedAt: new Date() });

    const res = await asUser(viewer.id).get(`/feed?petId=${pet.id}`);
    const ids = res.body.posts.map((p: { id: string }) => p.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(archived.id);
  });
});
