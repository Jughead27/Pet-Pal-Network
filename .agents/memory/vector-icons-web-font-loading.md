---
name: Vector Icons Web Font Loading
description: @expo/vector-icons icon sets render as empty squares on web unless fonts are explicitly pre-loaded in useFonts.
---

On web static export (`expo export --platform web`), `@expo/vector-icons` font glyphs (Feather, MaterialCommunityIcons, Ionicons) appear as empty squares unless their TTF files are included in the `useFonts` call.

Custom SVG components (SniffIcon, HatchlingIcon using react-native-svg) are unaffected — they don't depend on font loading.

**Fix:** In `app/_layout.tsx`, spread each icon set's `.font` static property into `useFonts`:
```typescript
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Ionicons from '@expo/vector-icons/Ionicons';

useFonts({
  ...InterFonts,
  ...Feather.font,
  ...MaterialCommunityIcons.font,
  ...Ionicons.font,
});
```

**Why:** The `.font` static property (`{ [fontName]: assetId }`) is set by `createIconSet` in `@expo/vector-icons`. On native, fonts are loaded lazily per icon render; on web the static export has no lazy-load path so the glyph files are never included.

**How to apply:** Any time a new icon family is added from `@expo/vector-icons`, add its `.font` to the `useFonts` call in `app/_layout.tsx`. Verified on `@expo/vector-icons` v15.1.1.
