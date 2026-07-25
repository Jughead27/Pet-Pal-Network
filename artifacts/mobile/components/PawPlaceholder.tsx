/**
 * PawPlaceholder — shown in place of a post image that fails to load.
 *
 * Renders a muted paw glyph centred on a near-black background so the
 * failure is acknowledged without being jarring.  The style prop is
 * forwarded directly so the placeholder occupies the same space as the
 * image it replaces (same width, height, borderRadius, etc.).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface Props {
  style?: StyleProp<ViewStyle>;
}

export default function PawPlaceholder({ style }: Props) {
  return (
    <View style={[styles.container, style]}>
      <Svg
        width={36}
        height={36}
        viewBox="0 0 24 24"
        fill="rgba(255,255,255,0.14)"
        stroke="none"
      >
        <Path d="M7.2 7.24a1.9 1.9 0 0 0-1.9 2.4c.19.98 1.04 1.7 2.09 1.52A2.19 2.19 0 0 0 9.1 9.4a1.9 1.9 0 0 0-1.9-2.16zm9.6 0a1.9 1.9 0 0 0-1.9 2.16 2.19 2.19 0 0 0 1.71 1.76c1.05.18 1.9-.54 2.09-1.52a1.9 1.9 0 0 0-1.9-2.4zM10 4.1a1.8 1.8 0 0 0-1.8 2.3 2.11 2.11 0 0 0 1.64 1.7c1.02.17 1.83-.52 1.96-1.5A1.8 1.8 0 0 0 10 4.1zm4 0a1.8 1.8 0 0 0-1.8 2.5c.13.98.94 1.67 1.96 1.5A2.11 2.11 0 0 0 15.8 6.4 1.8 1.8 0 0 0 14 4.1zM12 11c-2.6 0-4.9 2-4.9 4.3 0 1.6 1.2 2.7 2.8 2.7 1 0 1.5-.4 2.1-.4s1.1.4 2.1.4c1.6 0 2.8-1.1 2.8-2.7C16.9 13 14.6 11 12 11Z" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0A0F14',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
