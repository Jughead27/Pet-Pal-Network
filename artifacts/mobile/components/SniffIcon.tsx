/**
 * SniffIcon — custom nose-with-scent-lines SVG for the Sniff tab.
 * Uses stroke="currentColor" so it inherits active/inactive nav tint automatically.
 */

import React from 'react';
import Svg, { Path } from 'react-native-svg';

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
      <Path d="M11 18.5C7.5 16 5.5 13.4 5.5 11c0-2.6 2.5-4 5.5-4s5.5 1.4 5.5 4c0 2.4-2 5-5.5 7.5Z" />
      <Path d="M9.2 10.6c-.4.7-.4 1.3 0 1.9" />
      <Path d="M12.8 10.6c.4.7.4 1.3 0 1.9" />
      <Path d="M18 8.5c.9-.5 1.4-1.3 1.5-2.4" />
      <Path d="M19.5 12c1-.3 1.7-1 2-2" />
    </Svg>
  );
}
