/**
 * SniffIcon — solid-filled dog silhouette, side profile facing left,
 * nose at ground, tail raised. K9 / detection-dog sniffing posture.
 *
 * Multi-element composition — all fill currentColor so they merge into
 * one solid silhouette. This gives precise width control over the tail
 * (~3 px) and legs (~3 px) that a single closed path loses at small scale.
 *
 * Elements:
 *   Tail  — explicit filled wedge, ~3 px wide, rises upper-right
 *   Body  — chunky horizontal ellipse, the main torso mass
 *   Head  — separate path drooping sharply below body to near ground
 *   Legs  — two chunky 3 px rounded rects, front pair and rear pair
 */

import React from 'react';
import Svg, { Ellipse, Path, Rect } from 'react-native-svg';

interface SniffIconProps {
  size?: number;
  color?: string;
}

export default function SniffIcon({ size = 24, color = 'currentColor' }: SniffIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">

      {/* ── Tail: wide wedge rising to upper-right ── */}
      <Path
        d="M 21 3 C 19.5 6 18 9 17 11 L 18.5 12.5 C 20.5 9 22 6 21 3 Z"
        fill={color}
        stroke="none"
      />

      {/* ── Body: chunky horizontal ellipse ── */}
      <Ellipse
        cx="13"
        cy="12"
        rx="6"
        ry="3.5"
        fill={color}
        stroke="none"
      />

      {/* ── Head + neck: droops sharply from body front toward ground ──
           Starts inside the body ellipse so the join is gapless.
           Nose reaches ~y=22.5, well below body bottom at y=15.5.
      */}
      <Path
        d="M 10 12.5
           C 9 13.5 8 15.5 7 17.5
           C 6 19.5 5 21 4 22.5
           C 3.5 23 4 23.5 5 23
           C 6 22.5 7 21.5 8 20
           C 9 18.5 10 17 10.5 15.5
           C 11 14 10.5 12.5 10 12.5 Z"
        fill={color}
        stroke="none"
      />

      {/* ── Front legs: chunky 3 × 7 px rounded rect ── */}
      <Rect x="9" y="15" width="3" height="7" rx="1.5" fill={color} stroke="none" />

      {/* ── Rear legs: chunky 3 × 8 px rounded rect ── */}
      <Rect x="15" y="14" width="3" height="8" rx="1.5" fill={color} stroke="none" />

    </Svg>
  );
}
