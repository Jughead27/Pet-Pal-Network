/**
 * RATE LIMITING — spot-checks that the in-memory per-user limiters in
 * posts.ts (25/min per action) and uploads.ts (30/min) actually return 429
 * after the threshold. The limiter is checked before body validation, so
 * cheap invalid bodies (400) are used to consume the budget.
 *
 * Limiter maps are module-level and keyed by user id, so a fresh test user
 * per test gives an isolated counter.
 */
import { describe, expect, it } from "vitest";
import { asUser } from "./helpers/harness.js";
import { createTestUser } from "./helpers/factories.js";

describe("rate limiting", () => {
  it("POST /posts 429s after 25 requests in a minute", async () => {
    const user = await createTestUser();
    for (let i = 0; i < 25; i++) {
      const res = await asUser(user.id).post("/posts").send({});
      expect(res.status).toBe(400); // invalid body, but under the limit
    }
    const limited = await asUser(user.id).post("/posts").send({});
    expect(limited.status).toBe(429);
  });

  it("POST /uploads/presign 429s after 30 requests in a minute", async () => {
    const user = await createTestUser();
    for (let i = 0; i < 30; i++) {
      const res = await asUser(user.id).post("/uploads/presign").send({});
      expect(res.status).toBe(400);
    }
    const limited = await asUser(user.id).post("/uploads/presign").send({});
    expect(limited.status).toBe(429);
  });
});
