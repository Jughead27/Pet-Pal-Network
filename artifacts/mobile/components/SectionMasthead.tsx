/**
 * SectionMasthead — icon glyph + wordmark on a single left-aligned row.
 *
 * Typographic only: no background, no border, no pill/capsule shapes.
 * The icon (passed as ReactNode) should be pre-sized by the caller to
 * match the text cap-height — 18 px works well alongside the 21 px wordmark.
 *
 * Both glyph and wordmark render at ~82% foreground opacity so the masthead
 * reads as a calm label rather than the dominant element on screen.
 *
 * Appears in grid mode only; callers are responsible for not rendering
 * this component when the screen is in pager mode.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface SectionMastheadProps {
  /** Pre-sized icon element — use the tab's existing SVG icon component. */
  icon: React.ReactNode;
  /** Section name rendered in Inter Medium 21 px. */
  title: string;
  /** Optional extra style on the outer row (e.g. for paddingTop / positioning). */
  style?: StyleProp<ViewStyle>;
}

export default function SectionMasthead({ icon, title, style }: SectionMastheadProps) {
  const colors = useColors();
  return (
    <View style={[styles.row, style]}>
      <View style={styles.iconWrapper}>{icon}</View>
      <Text style={[styles.wordmark, { color: colors.foreground }]}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               7,
    paddingHorizontal: 16,
    paddingBottom:     4,
  },
  // Wrap the icon so its opacity is independent of the row background.
  iconWrapper: {
    opacity: 0.82,
  },
  wordmark: {
    fontFamily:    'Inter_500Medium',
    fontSize:      21,
    lineHeight:    25,
    letterSpacing: -0.3,
    opacity:       0.82,
  },
});
