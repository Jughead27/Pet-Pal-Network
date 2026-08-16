import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { type Icon as PhosphorIcon } from 'phosphor-react-native';

// ─── Glyph shadow helper ──────────────────────────────────────────────────────
// Wraps each rail glyph in a View that applies a soft, blurred drop-shadow:
//
//   Web  — CSS `filter: drop-shadow(…)` follows the SVG outline exactly, so
//           there is no rectangle and no hard double-image.  This is the same
//           technique Instagram / TikTok use for their over-photo rail icons.
//
//   iOS / Android — React Native View shadow props produce a Gaussian-blurred
//           shadow with a real shadowRadius; it is not perfectly glyph-shaped
//           but is tight and soft enough to look equivalent in practice.
//
// No duplicate glyph, no background rect, no box-shadow tile.

interface GlyphShadowProps {
  // The Phosphor icon component (e.g. HandTap, Bone, ChatCircle …)
  icon: PhosphorIcon;
  color: string;
  size: number;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
}

export function WithGlyphShadow({ icon: Icon, color, size, weight = 'regular' }: GlyphShadowProps) {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <View style={Platform.OS === 'web' ? (glyphShadowStyles.web as any) : glyphShadowStyles.native}>
      <Icon color={color} size={size} weight={weight} />
    </View>
  );
}

const glyphShadowStyles = StyleSheet.create({
  // Web: CSS filter drop-shadow follows the SVG glyph shape — no box.
  // `filter` is not in RN's StyleSheet types; cast at call-site via (as any).
  web: {
    // @ts-ignore — valid CSS property, not in RN types
    filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.60))',
  },
  // Native: blurred View shadow — closest achievable without react-native-svg
  // filter wiring.  shadowRadius gives the Gaussian blur on iOS; elevation
  // maps to Material shadow on Android.
  native: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.55,
    shadowRadius: 3,
    elevation: 4,
  },
});
