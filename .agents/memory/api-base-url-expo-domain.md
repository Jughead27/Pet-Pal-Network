---
name: API Base URL — Expo domain split
description: Why setBaseUrl must be called in _layout.tsx and how the Expo/Replit domain split causes silent fetch failures.
---

The mobile artifact uses `router = "expo-domain"` in `artifact.toml`. This means:

- **Expo web preview** runs at `https://<REPLIT_EXPO_DEV_DOMAIN>` (a separate subdomain, e.g. `*.expo.kirk.replit.dev`)
- **API server** is proxied at `/api/*` on the **main** Replit dev domain (`*.replit.dev`)

These are different origins. A relative `fetch('/api/feed')` from the web app resolves against the Expo origin, hits the Metro bundler, and never reaches the API server — which is why the server log shows zero `/api/*` entries while the app crashes.

On **Expo Go (native)**, React Native's `fetch` does not support relative URLs at all.

**Fix**: call `setBaseUrl('https://' + process.env.EXPO_PUBLIC_DOMAIN)` at module level in `_layout.tsx` **before** any component renders. `EXPO_PUBLIC_DOMAIN` is already injected as `$REPLIT_DEV_DOMAIN` by the `dev` script.

**Why:** Both platforms need an absolute URL pointing at the main Replit dev domain where the `/api` proxy route lives.

**How to apply:** Any time a new pnpm-monorepo project adds an API server artifact alongside an Expo mobile artifact with `router = "expo-domain"`, add the `setBaseUrl` call immediately — do not rely on relative URLs working from the Expo domain.
