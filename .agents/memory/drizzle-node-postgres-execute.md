---
name: Drizzle node-postgres db.execute() return shape
description: db.execute(sql`...`) returns a pg.QueryResult object, not a bare array — always destructure .rows
---

## Rule

`db.execute(sql\`...\`)` with `drizzle-orm/node-postgres` + `pg` returns a `pg.QueryResult<Row>` object:

```ts
{ rows: Row[], rowCount: number, fields: FieldDef[], command: string, ... }
```

**Always destructure `.rows`:**

```ts
// CORRECT
const { rows } = await db.execute(sql`SELECT ...`);
rows.map(...)

// WRONG — rows is a QueryResult object, not an array
const rows = await db.execute(sql`SELECT ...`);
rows.map(...)  // TypeError: rows.map is not a function
```

**Why:** The `pg` driver (node-postgres) wraps results in a `QueryResult` envelope. Drizzle's `node-postgres` adapter does not unwrap it. This differs from adapters like `postgres.js` or `neon-http` which may return rows directly.

**How to apply:** Any handler that uses `db.execute(sql\`...\`)` for raw SQL must destructure `.rows`. Also applies to `res.json({ ... rows ... })` usages — passing the QueryResult object directly serializes wrong shape.

**Confirmed bug:** `/api/admin/reports` crashed with `TypeError: rows.map is not a function` in production. Same latent bug was present in `/api/admin/breed-suggestions`. Both fixed by switching to `const { rows } = await db.execute(...)`.
