/**
 * PawIcon — reusable monochrome SVG paw glyph.
 *
 * The first glyph of the app's custom icon family. Accepts an arbitrary
 * fill color so it can be used on any background (feed overlay, chip
 * avatar fallback, pack follow button, etc.).
 *
 * No Reanimated. Pure SVG — always crisp at any size.
 */

import React from 'react';
import Svg, { Ellipse, Path } from 'react-native-svg';

export interface PawIconProps {
  /** Rendered size in dp. Default: 24. */
  size?: number;
  /** Fill color (any valid CSS / RN color string). Default: '#F0F4F8'. */
  color?: string;
}

export default function PawIcon({ size = 24, color = '#F0F4F8' }: PawIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      {/* Outer toes */}
      <Ellipse cx={7.2}  cy={9.4} rx={1.9} ry={2.4} transform="rotate(-20, 7.2, 9.4)" />
      <Ellipse cx={16.8} cy={9.4} rx={1.9} ry={2.4} transform="rotate(20, 16.8, 9.4)" />
      {/* Inner toes */}
      <Ellipse cx={10} cy={6.4} rx={1.8} ry={2.3} transform="rotate(-8, 10, 6.4)" />
      <Ellipse cx={14} cy={6.4} rx={1.8} ry={2.3} transform="rotate(8, 14, 6.4)" />
      {/* Main pad */}
      <Path d="M12 11c-2.6 0-4.9 2-4.9 4.3 0 1.6 1.2 2.7 2.8 2.7 1 0 1.5-.4 2.1-.4s1.1.4 2.1.4c1.6 0 2.8-1.1 2.8-2.7C16.9 13 14.6 11 12 11Z" />
    </Svg>
  );
}
