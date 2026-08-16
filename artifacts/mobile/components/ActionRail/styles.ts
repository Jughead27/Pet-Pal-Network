import { StyleSheet } from 'react-native';

// ─── Styles ──────────────────────────────────────────────────────────────────

export const styles = StyleSheet.create({
  rail: {
    alignItems: 'center',
    gap: 22,
    paddingVertical: 4,
    // overflow: visible is required on iOS — RN defaults to 'hidden' for Views,
    // which would clip the ripple ring as it expands beyond the rail column.
    overflow: 'visible',
  },
  treatSection: {
    alignItems: 'center',
    position: 'relative',
  },
  // Transient label: positioned BELOW the treat icon+count (top: 44) so it sits
  // beneath the pop spawn zone. Yum! pops spawn at ~bottomOffset+143 (above the
  // treat section bottom) and float upward — placing the label below that level
  // ensures pops never float through it. right: 50 / width: 120 keeps it well
  // left of the rail column.
  transientLabel: {
    position: 'absolute',
    right: 50,
    width: 120,
    textAlign: 'right',
    top: 44,
    fontSize: 10,
    fontWeight: '600' as const,
    lineHeight: 13,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pointerEvents: 'none' as any,
  },
  itemWrapper: {
    alignItems: 'center',
    position: 'relative',
    // Must be visible on iOS — default is hidden, which clips the ripple ring.
    overflow: 'visible',
    // No background or box-shadow here — shadow is applied per-glyph via
    // WithGlyphShadow so it follows the icon outline, not a rectangle.
  },
  itemTouchable: {
    alignItems: 'center',
    gap: 4,
    width: 40,
    paddingVertical: 2,
    // Must be visible: TouchableOpacity is a View on iOS; without this, the
    // 40px-wide touchable clips the ~102px-diameter ripple ring at the boundary.
    overflow: 'visible',
  },
  // Boop icon container — overflow: visible so ripple rings expand beyond
  // the 40×40 bounds without being clipped. Fixed size for consistent ripple
  // positioning via absolute centering.
  boopIconArea: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  count: {
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
    textAlign: 'center',
    color: 'rgba(240,244,248,0.85)',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ textShadow: '0px 1px 3px rgba(0,0,0,0.4)' } as any),
  },
});
