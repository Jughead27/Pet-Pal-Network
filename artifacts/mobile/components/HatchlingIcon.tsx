/**
 * HatchlingIcon — chick with a large off-center head, curved neck, and beak
 * pointing right, emerging from a cracked half-eggshell.
 *
 * Key features preserved for readability at small size:
 *   - Large round head, offset to the right (cx 14.2)
 *   - Curved neck (two converging curved paths, never straight/vertical)
 *   - Beak pointing right
 *   - Wide zigzag crack rim + rounded shell cup
 */

import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface HatchlingIconProps {
  size?: number;
  color?: string;
}

export default function HatchlingIcon({ size = 24, color = 'currentColor' }: HatchlingIconProps) {
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
      {/* Head — large, offset right */}
      <Circle cx={14.2} cy={6.8} r={2.9} />

      {/* Eye */}
      <Circle cx={15.1} cy={6.2} r={0.45} fill={color} stroke="none" />

      {/* Beak pointing right */}
      <Path d="M17.1 6.5l2 .8-2 .8" />

      {/* Curved neck — two converging lines, left and right sides */}
      <Path d="M11.2 15c.1-3 .6-5 1.6-6.4" />
      <Path d="M14 15c-.2-2 .1-3.6.7-5" />

      {/* Cracked shell rim — wide zigzag */}
      <Path d="M6.5 14.5l2.3 1.8 2.3-1.8 2.3 1.8 2.3-1.8 2.3 1.8" />

      {/* Shell cup */}
      <Path d="M6.5 14.5c0 3.2 2.4 5 5.75 5s5.75-1.8 5.75-5" />
    </Svg>
  );
}
