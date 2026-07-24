/**
 * SniffIcon — pig snout with two nostrils and faint scent swirls above.
 *
 * Geometrically simple so it renders cleanly at 22px nav size:
 *   - Rounded-rectangle snout (Rect with large rx)
 *   - Two filled oval nostrils
 *   - Two small scent squiggles rising above
 *
 * Uses stroke/fill="currentColor" so active/inactive tint works automatically.
 */

import React from 'react';
import Svg, { Path, Ellipse, Rect } from 'react-native-svg';

interface SniffIconProps {
  size?: number;
  color?: string;
}

export default function SniffIcon({ size = 24, color = 'currentColor' }: SniffIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Snout: pill-shaped rounded rectangle */}
      <Rect x={4} y={9} width={16} height={11} rx={5.5} />

      {/* Left nostril — filled so it reads clearly at small size */}
      <Ellipse cx={9} cy={14.5} rx={1.6} ry={2} fill={color} stroke="none" />

      {/* Right nostril */}
      <Ellipse cx={15} cy={14.5} rx={1.6} ry={2} fill={color} stroke="none" />

      {/* Scent swirls rising from the snout */}
      <Path d="M9 8.5 Q8 7 9 5.5 Q10 4 9 3" />
      <Path d="M15 8.5 Q16 7 15 5.5 Q14 4 15 3" />
    </Svg>
  );
}
