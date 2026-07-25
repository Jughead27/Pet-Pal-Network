# Pet Pal Network (product name: Snout Stack)

A pet-only social network: pets are the profiles, humans are accounts that act on their behalf. Photo/video-first immersive feed for web, iOS, and Android.

## Product principles

- Animals are the subject. Humans may appear in posts, but are never the focus. Content that is not animal-based is off-topic and reportable.
- This app is deliberately an anxiety-free space: no politics, no user-level status metrics (followers belong to pets, never users), no negative reaction mechanics (boops and treats only — there is no dislike).
- Playful, warm tone everywhere. Moderation (Phase 7) enforces these principles: report reasons include "not animal content" and "animal cruelty / welfare concern" (highest priority).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 — ALL data access goes through it
- DB: Replit PostgreSQL + Drizzle ORM (schema source of truth: `lib/db/src/schema/`)
- Auth: Clerk (planned) — NOT Replit Auth; this is a consumer app needing its own branded login
- Media: Cloudflare R2 (planned) — all images/video; the database stores keys/URLs only
- App: Expo / React Native in `artifacts/mobile`, one codebase for web + iOS + Android
- API contracts: OpenAPI spec in `lib/api-spec` → Orval codegen → typed React Query client (`lib/api-client-react`) used by the app
- Validation: Zod (`zod/v4`), `drizzle-zod`

## Vocabulary (locked — use these words everywhere, in UI and code)

- **Boop** = like. Unlimited, claps-style: every press adds one. Event rows, NO unique constraint.
- **Treat** = super-reaction. Scarce: 5 per user per day, server-enforced from a config table. Bone icon.
- **Pack** = follow a pet ("Add to Pack"). The paw icon is EXCLUSIVE to Pack/follow.
- **Parrot** = repost (future feature).
- **Sniff** = explore tab.
- **Nursery** = per-POST baby-content flag, set at upload.
- Rule: playful names for social actions and places; boring names for utilities (Add, Profile, Settings).

## Design system (locked)

- Inter only; monochrome ink; full-bleed immersive media; frosted-glass bottom nav.
- Teal is the SOLE nav accent (active tab). Coral `#FF7A5C` and gold `#F4C542` are reserved EXCLUSIVELY for boop/treat reacted states.
- Icons: one shared react-native-svg component per icon, used by all platforms. Solid filled silhouettes for figurative shapes; one shared optical baseline.

## Architecture decisions

- The app NEVER queries the database directly. Every read/write goes through the Express API; authorization is enforced in API middleware. (This is the project's security model — treat it like RLS.)
- Treat cap (5/user/day) is enforced server-side in a transaction, reading the limit from a `config` table. Self-treating (treating your own pet) is rejected server-side.
- Boops are unlimited event rows. Treats are event rows plus the daily cap.
- Media uploads: API issues presigned R2 URLs; client compresses images to max 2048px longest edge (JPEG/WebP) before upload; video max 60s / 150MB, MP4/MOV/WebM. Limits validated server-side as well.
- New API endpoints are defined in `lib/api-spec/openapi.yaml` first, then codegen, then implemented — keep spec and server in sync.

## Cost guardrails

- Media files live in R2 ONLY. NEVER store binary media in Postgres (DB storage ≈ $1.50/GiB/mo; R2 ≈ $0.015/GB with free egress). The database stores text and R2 keys/URLs only.
- Client-side image compression before upload is mandatory (cost and bandwidth control), with server-side size/type validation as backstop.
- One deployment. Do not create additional deployments, scheduled deployments, or reserved VMs unless the user explicitly asks.
- Keep work scoped to the single change requested. Do not refactor, reformat, or "improve" unrelated code — it burns credits and risks regressions.

## Gotchas (hard-won — do not relearn)

- Native behavior is verified in Expo Go on a physical device. The web preview lies about native.
- NO `react-native-reanimated` imports anywhere — use React Native's built-in Animated API only. (The package remains in package.json solely as a required peer dependency; never import it, never add its babel plugin.)
- NO NativeTabs / SF-symbol tab paths — classic Tabs only. NativeTabs silently swaps custom icons for Apple glyphs.
- Icons are shared react-native-svg components (Svg, Path, Circle, Ellipse, Rect). Never raw `<svg>` markup, never per-platform icon forks.
- The raised Add button requires `overflow: visible` on the nav bar and ALL ancestor containers — restyling the bar can silently reintroduce clipping.
- Every behavior change applies identically to web, iOS, and Android.
- Deliberately accepted platform divergences — do NOT "fix": iOS system nav height + safe-area insets, hairline borders, CoreText font rendering, status bar behavior; Android nav bar uses a solid background (no blur).
- REGRESSION RULE: before rewriting or substantially modifying any screen or component, enumerate its existing capabilities and preserve every one unless the prompt explicitly says to remove it. Losing existing functionality (e.g., a sign-out button, a navigation path, an empty state) is a failed delivery even if the new feature works.
- After any delivery, verify the golden path still works: sign in → feed loads → boop persists → post a photo → sign out.

## User preferences

- One scoped change per prompt, with an explicit do-not-modify list and an acceptance test.
- State design INTENT; never substitute stand-in assets or nearest-equivalent icons.
- Do not reintroduce removed libraries or migrate working code to new libraries unprompted.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details