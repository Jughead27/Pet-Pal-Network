/**
 * HatchlingIcon — custom hatchling-chick-in-cracked-egg SVG for the Nursery tab.
 * Uses stroke="currentColor" so it inherits active/inactive nav tint automatically.
 */

import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

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
      <Path d="M8 11a4 4 0 0 1 8 0" />
      <Circle cx={10.6} cy={9.6} r={0.4} fill={color} stroke="none" />
      <Path d="M16 9.8l2 .9-2 .9" />
      <Path d="M6.5 12l1.85 1.8L10.2 12l1.85 1.8L13.9 12l1.85 1.8L17.5 12" />
      <Path d="M6.5 12c0 4 2.4 6.5 5.5 6.5s5.5-2.5 5.5-6.5" />
    </Svg>
  );
}
