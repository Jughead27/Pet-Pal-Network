---
name: Clerk Auth Integration
description: How Clerk auth is wired into the Fish Book mobile app and API server, and the quirks encountered.
---

## Structure

- `ClerkProvider` wraps the entire root layout (`app/_layout.tsx`) — outside SafeAreaProvider so it's available everywhere.
- `tokenCache` uses `expo-secure-store` on native, `undefined` on web (Clerk uses localStorage as fallback).
- `ClerkTokenSync` component (rendered in root layout inside ClerkProvider) calls `setAuthTokenGetter(() => getToken())` when signed in, `null` when signed out — wires Clerk JWT into the API client automatically.
- Auth group: `app/(auth)/_layout.tsx` redirects signed-in users to `/(tabs)`.
- Tab group: `app/(tabs)/_layout.tsx` redirects signed-out users to `/(auth)/sign-in` (4-line guard at top of component, nothing else modified).

## Google SSO

Included via `useSSO` hook + `expo-web-browser` (already installed). Works in Expo Go browser-based flow. Requires Google to be enabled as an OAuth provider in the Clerk dashboard. Redirect URL uses `Linking.createURL('/')`.

## API Server

`@clerk/backend` installed. `verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })` in `requireClerkAuth.ts` middleware. Middleware is applied in `routes/index.ts` AFTER the healthz router — so `/api/healthz` is public, everything else requires Bearer token.

## Package Quirks

- `@clerk/clerk-expo` requires `expo-auth-session` as a peer dep (for `useSSO`). Expo SDK 54 compatible version: `~7.0.11`.
- `expo-secure-store` Expo 54 compatible version: `~15.0.8` (pnpm installs 57.x by default).
- `@clerk/shared` postinstall script creates `_tmp_NNNN` directories that are immediately deleted. Metro's FallbackWatcher crashes with ENOENT trying to watch them. Fix: add `config.resolver.blockList = [/_tmp_\d+/]` to `metro.config.js`.
- **Do NOT use `exclusionList` from `metro-config`** — it does not exist in this Metro version. Use a raw regex array directly.

**Why:** These are not documented in the Clerk Expo docs and cost significant debugging time.
