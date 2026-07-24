/**
 * SniffIcon — pig snout: rounded-square body, bold solid nostrils, long scent lines.
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
      {/* Snout: rounded-square (less wide, taller) */}
      <Rect x={4.5} y={7.5} width={13} height={11} rx={5} />

      {/* Nostrils: bold, solid filled */}
      <Ellipse cx={8.6}  cy={13} rx={1.5} ry={2.3} fill={color} stroke="none" />
      <Ellipse cx={13.4} cy={13} rx={1.5} ry={2.3} fill={color} stroke="none" />

      {/* Scent lines: long, clearly visible, upper right */}
      <Path d="M19.3 8.2c.9-.7 1.4-1.6 1.5-2.9" />
      <Path d="M20.8 11.8c1-.5 1.7-1.3 2-2.4" />
    </Svg>
  );
}
