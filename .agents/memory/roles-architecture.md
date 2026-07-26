---
name: Roles Architecture
description: How admin/member roles are stored, enforced, and seeded — never stored client-side.
---

## Rule
`role` lives in the `users` table (enum `user_role`: `'member' | 'admin'`, NOT NULL, default `'member'`).  
It is read once by `requireClerkAuth` and attached to `req.auth.role`.  
`requireRole('admin')` middleware is the ONLY place role is checked — never inline in routes.

**Why:** Single enforcement point; role can never be spoofed via client-supplied data.

## How to apply
- All admin routes: `router.use(requireClerkAuth)` then `.get('/admin/...', requireRole('admin'), handler)`.
- `requireRole` must come AFTER `requireClerkAuth` (it reads `req.auth` which auth sets).
- Never read role from request body/query/headers.

## Seeding admins
Script: `artifacts/api-server/scripts/seed-admin.ts`  
Run with: `/path/to/tsx /home/runner/workspace/artifacts/api-server/scripts/seed-admin.ts`  
(uses lib/db tsx binary since api-server doesn't have tsx in devDeps)  
Idempotent: "already admin" rows are skipped with no DB write.  
Add emails to `ADMIN_EMAILS` array in the script.

## Key files
- Schema: `lib/db/src/schema/users.ts` — `userRoleEnum` + `role` column
- Auth middleware: `artifacts/api-server/src/middlewares/requireClerkAuth.ts` — attaches `{ userId, role }`
- Role guard: `artifacts/api-server/src/middlewares/requireRole.ts`
- Admin routes: `artifacts/api-server/src/routes/admin.ts`
- Seed script: `artifacts/api-server/scripts/seed-admin.ts`
