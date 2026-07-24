/**
 * SniffIcon — dog profile with head bowed, nose near ground, scent swirls rising.
 * Uses stroke="currentColor" so it inherits active/inactive nav tint automatically.
 *
 * Key readable elements at small sizes:
 *   - Floppy ear (immediately reads "dog")
 *   - Distinct downward-pointing snout
 *   - Nose dot at snout tip
 *   - Ground line
 *   - Two small scent swirls near the nose
 */

import React from 'react';
import Svg, { Path, Circle, Line } from 'react-native-svg';

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
      {/* Head upper outline: back of head → over crown → along snout top → nose tip */}
      <Path d="M5 12 Q4 7 7 5 Q10 3 13 4 Q17 4 18 7 Q21 8 21 12" />

      {/* Head lower outline: nose tip → under jaw → back of neck */}
      <Path d="M21 12 Q20 15 17 16 Q13 17 9 16 Q6 15 5 12" />

      {/* Floppy ear — key "dog" visual cue, hangs from upper-left of head */}
      <Path d="M7 5 Q4 6 4 10 Q4 13 5 14" />

      {/* Eye */}
      <Circle cx={13} cy={8} r={0.55} fill={color} stroke="none" />

      {/* Nose — at tip of snout */}
      <Circle cx={21} cy={12} r={0.7} fill={color} stroke="none" />

      {/* Ground line */}
      <Line x1={2} y1={21} x2={22} y2={21} />

      {/* Scent swirls rising from ground near nose */}
      <Path d="M18 20 Q17 18 18 17 Q19 16 18 15" />
      <Path d="M21 20 Q20 18 21 17 Q22 16 21 15" />
    </Svg>
  );
}
