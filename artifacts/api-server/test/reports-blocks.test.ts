/**
 * REPORTS & BLOCKS
 *
 * ★ APP-STORE-CRITICAL: Apple reviewers manually test content moderation —
 * reporting objectionable content and blocking abusive users (UGC
 * guideline 1.2). Regressions here are high priority.
 */
import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/harness.js";
import {
  createTestUser,
  createTestPet,
  createTestPost,
  createComment,
  createBlock,
} from "./helpers/factories.js";

describe("[APP-STORE-CRITICAL] POST /reports", () => {
  it("accepts every reason on the locked list and nothing else", async () => {
    const reporter = await createTestUser();
    const poster = await createTestUser();
    const pet = await createTestPet(poster.id);

    const reasons = [
      "not_animal_content", "animal_cruelty", "mislabeled_pet",
      "wrong_nursery_flag", "spam", "harassment", "other",
    ];
    for (const reason of reasons) {
      const post = await createTestPost(poster.id, [pet.id]); // fresh target per reason (duplicate guard)
      const res = await asUser(reporter.id)
        .post("/reports")
        .send({ targetType: "post", targetId: post.id, reason });
      expect(res.status, `reason=${reason}`).toBe(201);
    }

    const post = await createTestPost(poster.id, [pet.id]);
    const bad = await asUser(reporter.id)
      .post("/reports")
      .send({ targetType: "post", targetId: post.id, reason: "i_just_dislike_it" });
    expect(bad.status).toBe(400);
  });
});

describe("[APP-STORE-CRITICAL] blocks", () => {
  it("excludes blocked users' comments in both directions", async () => {
    const host = await createTestUser();
    const alice = await createTestUser();
    const bob = await createTestUser();
    const pet = await createTestPet(host.id);
    const post = await createTestPost(host.id, [pet.id]);
    await createComment(post.id, alice.id, "from alice");
    await createComment(post.id, bob.id, "from bob");

    await createBlock(alice.id, bob.id); // alice blocked bob

    const aliceView = await asUser(alice.id).get(`/posts/${post.id}/comments`);
    expect(aliceView.status).toBe(200);
    const aliceTexts = JSON.stringify(aliceView.body);
    expect(aliceTexts).not.toContain("from bob");
    expect(aliceTexts).toContain("from alice");

    const bobView = await asUser(bob.id).get(`/posts/${post.id}/comments`);
    expect(bobView.status).toBe(200);
    const bobTexts = JSON.stringify(bobView.body);
    expect(bobTexts).not.toContain("from alice");
    expect(bobTexts).toContain("from bob");
  });
});
