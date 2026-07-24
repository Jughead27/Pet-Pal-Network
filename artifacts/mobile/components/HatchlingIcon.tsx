/**
 * HatchlingIcon — a small chick hatching from a cracked eggshell.
 *
 * Composition (top to bottom):
 *   - Three small feather tufts on the crown
 *   - Round chick head with eye dot
 *   - Small open beak pointing right
 *   - Jagged crack line dividing shell from chick
 *   - Rounded eggshell bowl below the crack
 *
 * Uses stroke="currentColor" so it inherits active/inactive nav tint.
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
      {/* ── Bottom eggshell bowl ── */}
      <Path d="M5 15 Q5 22 12 22 Q19 22 19 15" />

      {/* ── Jagged crack across the shell opening ── */}
      <Path d="M5 15 L7.5 13 L10 15 L12 12 L14 15 L16.5 13 L19 15" />

      {/* ── Chick head: upper arc rising above the crack ── */}
      {/* Endpoints sit just inside the shell rim so the chick reads as emerging */}
      <Path d="M8.5 15 Q8 6 12 6 Q16 6 15.5 15" />

      {/* ── Eye ── */}
      <Circle cx={13} cy={10} r={0.5} fill={color} stroke="none" />

      {/* ── Beak: right-facing open chevron ── */}
      <Path d="M15.5 10 L17.5 11 L15.5 12" />

      {/* ── Feather tufts on the crown ── */}
      <Path d="M10.5 6.5 L10 4.5" />
      <Path d="M12 6 L12 4" />
      <Path d="M13.5 6.5 L14 4.5" />
    </Svg>
  );
}
