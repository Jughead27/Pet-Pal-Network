---
name: Mobile Web Safe Area Bottom (Tab Bar)
description: iOS Safari browser chrome clips the bottom tab bar unless viewport-fit=cover + env(safe-area-inset-bottom) are used.
---

On mobile web (iOS Safari), the browser's own toolbar overlaps the viewport bottom. A fixed `height: 84, paddingBottom: 0` tab bar gets its icons/labels clipped under this chrome.

**Fix (two parts):**

1. `app.json` — add `viewport-fit=cover` so env() returns a real inset value:
   ```json
   "web": {
     "meta": {
       "viewport": { "content": "width=device-width, initial-scale=1, viewport-fit=cover" }
     }
   }
   ```

2. `app/(tabs)/_layout.tsx` — use `minHeight` + CSS env() instead of fixed height:
   ```javascript
   paddingBottom: isWeb ? ('env(safe-area-inset-bottom)' as any) : safeAreaInsets.bottom,
   ...(isWeb ? { minHeight: 84 } : {}),
   // Remove: ...(isWeb ? { height: 84 } : {}),
   ```
   `minHeight` ensures the bar is at least 84px; env() adds extra height for the safe area on iOS Safari. `height` is removed because border-box would clamp total height at 84px, eating the padding.

**Why:** `safeAreaInsets.bottom` from `react-native-safe-area-context` returns 0 on web. The CSS `env(safe-area-inset-bottom)` is the correct web counterpart and requires `viewport-fit=cover` in the HTML meta viewport tag.

**How to apply:** Any new bottom-fixed bar on web needs this same pattern.
