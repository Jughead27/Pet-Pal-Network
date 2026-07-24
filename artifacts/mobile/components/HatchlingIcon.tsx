/**
 * HatchlingIcon — chick with a large off-center head, curved neck, and beak
 * pointing right, emerging from a cracked half-eggshell.
 *
 * Key features preserved for readability at small size:
 *   - Large round head, offset to the right (cx 14.2)
 *   - Curved neck (two converging curved paths, never straight/vertical)
 *   - Beak pointing right
 *   - Wide zigzag crack rim + rounded shell cup
 *
 * All coordinates shifted +1.5 px downward from the original drawing so the
 * shell bottom (y≈21) overshoots the optical nav baseline (~y=20) by ~1 px —
 * the standard optical-correction for rounded bottoms.
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
      {/* Head — large, offset right (+1.5 from cy=6.8) */}
      <Circle cx={14.2} cy={8.3} r={2.9} />

      {/* Eye (+1.5 from cy=6.2) */}
      <Circle cx={15.1} cy={7.7} r={0.45} fill={color} stroke="none" />

      {/* Beak pointing right (+1.5 from y=6.5) */}
      <Path d="M17.1 8l2 .8-2 .8" />

      {/* Curved neck — two converging lines (+1.5 to M-point only) */}
      <Path d="M11.2 16.5c.1-3 .6-5 1.6-6.4" />
      <Path d="M14 16.5c-.2-2 .1-3.6.7-5" />

      {/* Cracked shell rim — wide zigzag (+1.5 from y=14.5) */}
      <Path d="M6.5 16l2.3 1.8 2.3-1.8 2.3 1.8 2.3-1.8 2.3 1.8" />

      {/* Shell cup — bottom reaches y≈21, 1 px below optical baseline (+1.5 from y=14.5) */}
      <Path d="M6.5 16c0 3.2 2.4 5 5.75 5s5.75-1.8 5.75-5" />
    </Svg>
  );
}
