/**
 * HatchlingIcon — chick with a distinct round head on a long neck,
 * emerging from a cracked half-eggshell.
 *
 * Key readable features preserved at small size:
 *   - Round head (circle)
 *   - Long neck (two angled paths)
 *   - Open beak (right-facing chevron)
 *   - Eye dot
 *   - Cracked shell rim (zigzag) + rounded shell bowl
 *
 * Uses stroke/fill="currentColor" so active/inactive tint works automatically.
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
      {/* Round head */}
      <Circle cx={13.2} cy={6.8} r={2.6} />

      {/* Eye */}
      <Circle cx={14.1} cy={6.3} r={0.4} fill={color} stroke="none" />

      {/* Beak — right-facing open chevron */}
      <Path d="M15.8 6.6l2 .8-2 .8" />

      {/* Left neck line (head to shell) */}
      <Path d="M11.4 9.2C10.4 10.7 9.9 12.2 9.8 14" />

      {/* Right neck line (head to shell) */}
      <Path d="M15 9.3c-.7 1.5-.9 3-.9 4.7" />

      {/* Cracked shell rim — zigzag */}
      <Path d="M6.5 14l1.85 1.6L10.2 14l1.85 1.6L13.9 14l1.85 1.6L17.5 14" />

      {/* Shell bowl — rounded bottom half */}
      <Path d="M6.5 14c0 3.4 2.4 5.5 5.5 5.5s5.5-2.1 5.5-5.5" />
    </Svg>
  );
}
