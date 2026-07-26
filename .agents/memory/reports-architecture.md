---
name: Reports Architecture
description: How the user reporting feature works — schema, API route, mobile ReportFlow modal.
---

## Rule
Reports are write-only for members — they never see status, content never visibly changes.
Duplicate report (same reporter + target) → 200 `{ ok: true, duplicate: true }` (kind tone, no 409).
Rate limit: 10/user/hour, in-memory, keyed by userId.

**Why:** Per spec — silent, non-alarming UX. No content suppression from reports alone.

## How to apply
- New admin queue deliveries read `reportsTable` filtered by `status = 'pending'`.
- `reason` values are a locked enum — do not add new values without a DB migration.
- `targetId` is stored as text (not uuid FK) because a single column can't reference two tables.
- Existence of the target is validated at the API layer before insert.

## Key files
- Schema: `lib/db/src/schema/reports.ts` — enums `report_target_type`, `report_reason`, `report_status` + `reportsTable`
- API route: `artifacts/api-server/src/routes/reports.ts` — POST /reports, mounted in routes/index.ts
- Mobile modal: `artifacts/mobile/components/ReportFlow.tsx` — 3-step flow: reasons → note → done
- Post detail: `artifacts/mobile/app/post/[id].tsx` — "report" whisper in timestampRow
- Comments: `artifacts/mobile/components/CommentSheet.tsx` — long-press CommentRow → ReportFlow

## customFetch export
`customFetch` had to be added to `lib/api-client-react/src/index.ts` exports.
After any edit to that file, run `cd lib/api-client-react && npx tsc --build --force`.
