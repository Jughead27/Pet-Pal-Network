/**
 * SniffIcon — soft animal nose: wide heart shape with pointed bottom,
 * solid filled tilted nostrils, two curved scent lines.
 */

import React from 'react';
import Svg, { Path, Ellipse } from 'react-native-svg';

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
      {/* Nose body: wide rounded heart shape with pointed bottom */}
      <Path d="M10.5 19C6.6 16.4 4.5 13.9 4.5 11.3 4.5 8.6 7 7 10.5 7s6 1.6 6 4.3c0 2.6-2.1 5.1-6 7.7Z" />

      {/* Left nostril: solid filled, tilted slightly outward */}
      <Ellipse cx={8.3} cy={11.2} rx={1.05} ry={1.6} transform="rotate(-14 8.3 11.2)" fill={color} stroke="none" />

      {/* Right nostril: solid filled, tilted slightly outward */}
      <Ellipse cx={12.7} cy={11.2} rx={1.05} ry={1.6} transform="rotate(14 12.7 11.2)" fill={color} stroke="none" />

      {/* Scent lines rising upper right */}
      <Path d="M18.6 9.3c1-.6 1.5-1.6 1.6-3" />
      <Path d="M20 13.2c1.1-.4 1.9-1.2 2.2-2.4" />
    </Svg>
  );
}
