/**
 * SniffIcon — solid-filled dog silhouette, side profile facing left.
 * Sniffing posture: rump raised (upper-right), back slopes steeply down
 * toward the lowered shoulder, head hangs from shoulder with nose at
 * ground/foot level. Tail curves up from rump.
 *
 * Multi-element composition — all fill currentColor, so they merge into
 * one solid silhouette.
 *
 * Elements:
 *   Tail      — thick wedge rising upper-right from rump (unchanged)
 *   Body      — TILTED path: rump high right (~y=9), shoulder low left (~y=14)
 *   Head/neck — hangs from lowered shoulder; nose reaches y=22 (foot level)
 *   Front legs — 3×7 px below the lowered shoulder (y=15→22)
 *   Rear legs  — 3×10 px below the elevated rump (y=12→22)
 */

import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

interface SniffIconProps {
  size?: number;
  color?: string;
}

export default function SniffIcon({ size = 24, color = 'currentColor' }: SniffIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">

      {/* ── Tail: thick wedge, rises to upper-right from rump ── */}
      <Path
        d="M 21 3 C 19.5 6 18 9 17 11 L 18.5 12.5 C 20.5 9 22 6 21 3 Z"
        fill={color}
        stroke="none"
      />

      {/* ── Body: tilted — rump high (right ~y=9), shoulder low (left ~y=14) ──
           Topline has a natural hump near the spine, then slopes steeply down
           toward the front. Belly mirrors the slope in reverse.
           Tail base at (17,11) and (18.5,12.5) fall inside the rump region. ✓
           Head path starts at (9,14), inside the shoulder region. ✓
      */}
      <Path
        d="M 19 9
           C 17 7.5 13 8 9 11
           C 8 11.5 7 12.5 7 14
           C 7 15 8 15.5 9 15.5
           C 12 15 15 13.5 18 12.5
           C 19.5 12 20 11 19 9 Z"
        fill={color}
        stroke="none"
      />

      {/* ── Head + neck: hangs from lowered shoulder, nose at foot level (y=22) ──
           Front of neck sweeps left-and-down from the shoulder.
           Nose at (3,22) matches front-leg bottom at y=22 → nose to ground. ✓
      */}
      <Path
        d="M 9 14
           C 8 15 7 16.5 5 18
           C 4 19.5 3 21 3 22
           C 2.5 23 3.5 23.5 4.5 22
           C 5.5 21 6 20 7 18.5
           C 8 17 9.5 15.5 10 14
           C 10.5 13 9.5 13.5 9 14 Z"
        fill={color}
        stroke="none"
      />

      {/* ── Front legs: 3 × 7 px — below lowered shoulder ── */}
      <Rect x="9" y="15" width="3" height="7" rx="1.5" fill={color} stroke="none" />

      {/* ── Rear legs: 3 × 10 px — below elevated rump, still reach y=22 ── */}
      <Rect x="15" y="12" width="3" height="10" rx="1.5" fill={color} stroke="none" />

    </Svg>
  );
}
