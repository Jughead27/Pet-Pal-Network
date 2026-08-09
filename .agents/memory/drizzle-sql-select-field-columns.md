---
name: Drizzle sql`` columns in SELECT fields render unqualified
description: Columns interpolated into sql`` templates used as select fields render as bare "col", which subqueries capture — causes prod 500s or silent wrong results.
---

**Rule:** Never interpolate a drizzle column (e.g. `${usersTable.id}`) into a `sql\`\`` template that is used as a SELECT field and contains a subquery (EXISTS, scalar subselect). Drizzle renders it UNQUALIFIED (`"id"`), and inside the subquery that name binds to the subquery's own table.

**Why:** GET /users/:id/profile 500'd in production: `${usersTable.id}` inside an `EXISTS(SELECT 1 FROM blocks b ...)` rendered as `"id"`, bound to `blocks.id` (uuid) → Postgres 42883 `operator does not exist: text = uuid`. A sibling `${petsTable.id}` inside a posts scalar subselect would have bound to `posts.id` and silently matched nothing. The mobile app maps ANY query error to "Profile not found", so the 500 masqueraded as a 404 — root cause only surfaced by reading deployment logs during a live repro.

**How to apply:** In correlated subqueries inside select-field sql templates, hand-write the qualified outer reference as a fixed literal (`users.id`, `pets.id`) instead of interpolating the drizzle column. Multi-join queries (feed.ts) happen to render qualified and work — but don't rely on that. Also: when debugging "not found" reports, remember client error states may hide 500s; reproduce live and check deployment logs (autoscale instances recycle, so logs must be captured right after a repro).
