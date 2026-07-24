/**
 * SniffIcon — wide pig-snout pill with two solid filled nostrils and two
 * small scent lines rising off the upper right.
 *
 * No ears, antennae, or any element above the snout except the scent lines.
 * Filled nostrils are essential — do not convert to outlines.
 */

import React from 'react';
import Svg, { Rect, Ellipse, Path } from 'react-native-svg';

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
      {/* Snout: wide pill */}
      <Rect x={3.5} y={8.5} width={14} height={10} rx={5} />

      {/* Left nostril — solid filled */}
      <Ellipse cx={8} cy={13.5} rx={1.15} ry={1.8} fill={color} stroke="none" />

      {/* Right nostril — solid filled */}
      <Ellipse cx={13} cy={13.5} rx={1.15} ry={1.8} fill={color} stroke="none" />

      {/* Scent lines — upper right only */}
      <Path d="M18.8 8c.8-.6 1.2-1.4 1.3-2.5" />
      <Path d="M20.3 11.5c.9-.4 1.5-1.1 1.8-2.1" />
    </Svg>
  );
}
