/**
 * AUTH MIDDLEWARE
 *
 * ★ APP-STORE-CRITICAL: Apple reviewers manually exercise auth (sign-in,
 * suspended/deleted account lockout). Regressions here are high priority.
 */
import { describe, expect, it } from "vitest";
import { api, asUser } from "./helpers/harness.js";
import { createTestUser } from "./helpers/factories.js";

describe("[APP-STORE-CRITICAL] auth middleware", () => {
  it("valid session passes", async () => {
    const user = await createTestUser();
    const res = await asUser(user.id).get("/me");
    expect(res.status).toBe(200);
  });

  it("suspended user gets 403 {error:'suspended'}", async () => {
    const user = await createTestUser({ suspended: true });
    const res = await asUser(user.id).get("/me");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "suspended" });
  });

  it("tombstoned user gets 403 {error:'account_deleted'}", async () => {
    const user = await createTestUser({ deletedAt: new Date() });
    const res = await asUser(user.id).get("/me");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "account_deleted" });
  });

  it("missing token gets 401", async () => {
    const res = await api.get("/api/me");
    expect(res.status).toBe(401);
  });

  it("invalid token gets 401", async () => {
    const res = await api.get("/api/me").set("Authorization", "Bearer bogus-token");
    expect(res.status).toBe(401);
  });
});
