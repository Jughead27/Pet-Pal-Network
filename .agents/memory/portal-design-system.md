---
name: Portal Design System
description: Visual tokens and layout patterns for pshpsh auth screens (sign-in, sign-up, email-code, invite).
---

## Hardcoded tokens (no useColors on auth screens)
Auth screens bypass `useColors` and use hardcoded constants so the portal
never inherits a light palette accidentally:
- `BG = '#060B10'` — edge-to-edge dark ground
- `FG = '#F0F4F8'` — foreground / primary text
- `MUTED = '#6B7FA0'` — labels, hints, secondary actions
- `BORDER = '#182030'` — hairline underlines
- `DESTRUCTIVE = '#FF4444'` — inline errors

## Logo asset
`require('@/assets/icon.png')` — the B·R2 approved icon: top-down curled teal
tabby nest, visible paws; the same art as the app icon and splash screen.
Render at `200×200`, `resizeMode="contain"`. Do NOT use brand/B-ref1.png or
fullframe-v1/v2 on portal screens.

## Wide-viewport centering
ScrollView `contentContainerStyle={{ flexGrow: 1, alignItems: 'center' }}` +
inner `View` with `{ width: '100%', maxWidth: 430, paddingHorizontal: 32 }`.
Works on both native (fills screen) and web desktop (430px centered column).

## Input style
Inputs sit directly on the dark ground — no card container, no background fill.
Use hairline bottom-border only: `borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER`.

## Action hierarchy
1. Primary action — `Inter_700Bold` 17px, `FG`, text only (no shape/fill)
2. Secondary action ("continue with google") — `Inter_400Regular` 14px, `MUTED`
3. Whisper ("forgot password?", "resend code") — `Inter_400Regular` 12px, `MUTED` at `opacity: 0.7`

## All copy lowercase
Every string on portal screens is lowercase: wordmark, slogans, labels, button text, links.

## Invite endpoint
`POST /api/invites/request` — public (before requireClerkAuth).
Body: `{ email: string, note?: string }`.
Duplicate email → `{ ok: true, duplicate: true }` (200, kind tone).
Rate limit: 5/IP/hour, in-memory (resets on restart).
Table: `invite_requests` (id, email, note, requested_at, status='pending').

**Why:** Auth screens use this endpoint unauthenticated; mounting invitesRouter
before `requireClerkAuth` in routes/index.ts is intentional.
