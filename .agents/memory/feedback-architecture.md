---
name: Feedback Architecture
description: Member feedback channel — schema, rate-limited POST, admin inbox, reviewed audit action.
---

## Schema

```
feedback(
  id         uuid     PK  defaultRandom()
  user_id    text     NOT NULL FK → users.id
  body       text     NOT NULL            -- clamped to 1000 chars server-side
  status     feedback_status  NOT NULL default 'new'  -- enum: 'new' | 'reviewed'
  created_at timestamp NOT NULL default now()
)
```

## Rate limiter

In-memory `Map<userId, { count, resetAt }>` in `routes/feedback.ts` — 5 per user per hour. Identical pattern to reports.ts (which uses 10). No DB state — resets on server restart. Returns `HTTP 429 { ok: false, error: "too many submissions. try again later." }`.

## Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /feedback | member | body required, clamped to 1000 chars |
| GET | /admin/feedback | admin | paginated newest-first, `?limit=20&offset=0`, joins users for username |
| POST | /admin/feedback/:id/reviewed | admin | transaction + writeAudit('feedback.reviewed') |

## Audit action

`feedback.reviewed` — metadata: `{ submittedBy: userId }`. Same transaction pattern as all other admin mutations.

## Mobile entry point

- Profile screen: "send feedback" quiet touchable (`feedbackRow` / `feedbackText` styles, opacity 0.7, Inter_400Regular 13px) placed above sign-out row. Hidden when confirmSignOut is true.
- `FeedbackFlow.tsx` — modal component (portal visual system, pageSheet, grabber + close). Steps: compose → done. Auto-closes after 2.2 s.

## Admin

- Admin hub (`admin/index.tsx`) has a "Feedback" row pointing to `/admin/feedback`.
- `admin/feedback.tsx` — list screen, "mark reviewed" quiet action per new row, paginated with load-more.

## Production path

Reaches production automatically on next Publish via Replit's publish-time schema diff — same as every other new table. No manual migration needed.
