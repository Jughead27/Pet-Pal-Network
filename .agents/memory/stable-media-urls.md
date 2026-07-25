---
name: Stable Media URL Architecture
description: How post image URLs are generated and served — replaces perishable R2 presigned URLs with stable HMAC-signed proxy URLs.
---

## The problem
`presignGet` issued 1-hour presigned R2 URLs. React Query cached feed responses indefinitely, so cached responses held expired URLs → images 403'd → black posts.

## The solution
Feed/pet API responses return `/api/media/<key>?exp=<ts>&t=<hmac>` instead of presigned URLs.

### Server
- `mediaTokenUrl(key)` in `r2.ts` — HMAC-SHA256(key:exp, SESSION_SECRET), 48h expiry. Synchronous (no await needed).
- `verifyMediaToken(key, exp, t)` in `r2.ts` — timing-safe comparison, length check before `timingSafeEqual`.
- `GET /api/media/*` route in `routes/media.ts` — validates HMAC, calls `presignGet` for fresh R2 URL, returns 302 + `Cache-Control: public, max-age=300`.
- Registered BEFORE `requireClerkAuth` in `routes/index.ts` (uses HMAC token, not Clerk session).
- `feed.ts` and `pets.ts` both replaced `await presignGet` (async) with `mediaTokenUrl` (sync) — removed `Promise.all` wrappers.

### Client
- `resolveMediaKey` in `utils/mediaKey.ts` — prepends `getBaseUrl()` on native (relative `/api/media/…` → absolute URL for RN Image). Web resolves relative paths natively.
- `getBaseUrl()` exported from `lib/api-client-react/src/custom-fetch.ts` and `index.ts`.

### Error handling
- `MediaImage` component — wraps plain `<Image>`, retries once (cache-bust `?r=N`), then shows `PawPlaceholder`.
- `FocalImage` — same retry/placeholder logic added; `effectiveSource` memo + `retries` state + reset on `source` change.
- `PawPlaceholder` — muted paw SVG on `#0A0F14` background; accepts `StyleProp<ViewStyle>` for size/position.

**Why:** path-to-regexp v8 (Express 5 / router@2) does NOT support anonymous `*` wildcard — use a regex route instead: `router.get(/^\/media\/(.+)$/, ...)`. `req.params[0]` holds the captured key.

**How to apply:** Any new file-proxy-style route on this server must use regex or named wildcard syntax, never bare `*`.
