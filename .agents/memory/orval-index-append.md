---
name: Orval index.ts append behavior
description: Every codegen run appends duplicate export lines to lib/api-zod/src/index.ts and lib/api-client-react/src/index.ts; how to detect and fix.
---

## Rule
After every `pnpm --filter @workspace/api-spec run codegen` run, immediately overwrite both index files back to their canonical single-export forms before running typecheck.

**Why:** Orval v8 appends its default barrel lines to existing index files rather than replacing them. The result is duplicate `export *` lines (one double-quote, one single-quote). For `lib/api-zod`, orval also appends `export * from './generated/types'`, which collides with the Zod validator names (PascalCase) already exported from `./generated/api` — causing TS2308 errors for every request-body schema.

**How to apply:**
After every codegen run, write these exact contents:

`lib/api-zod/src/index.ts`:
```
export * from "./generated/api";
```

`lib/api-client-react/src/index.ts`:
```
export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter, getBaseUrl, customFetch } from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";
```
(Safest: `git checkout lib/api-client-react/src/index.ts` after codegen instead of retyping — the canonical form has grown exports over time.)

The `./generated/types` barrel is intentionally excluded from api-zod: Zod schemas in `api.ts` already infer TS types, and the separate TypeScript interfaces in `types/` create value-level name clashes for request-body schemas (e.g. `CreatePetBody`, `CreatePostBody`, `PresignUploadBody`).

## Expo package version mismatch
When adding expo packages, always pin them to the version Expo SDK 54 expects (shown by the Expo CLI warning). Use `~X.Y.Z` pin matching the warning, not the latest. Example: `expo-image-manipulator` must be `~14.0.8` for SDK 54 (not the latest `57.x`).
