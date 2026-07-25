/**
 * CropFramer — full-screen WYSIWYG framing step.
 *
 * Shows the photo at cover-fit within a configurable frame viewport.
 * The user drags along whichever axis has overflow to choose what part of
 * the photo will appear in the rendered surface.
 *
 * Props:
 *   frameHeight — height of the crop viewport in px (default: full screen height).
 *                 Pass SCREEN_HEIGHT * 0.42 for hero-aspect avatar framing.
 *
 * On "Done" calls onConfirm(focusX, focusY) with values in [0, 1].
 * focusX = 0.5, focusY = 0.5 means center (default cover behavior).
 *
 * No react-native-reanimated. Uses standard Animated + PanResponder.
 *
 * Presentation: rendered inside a <Modal presentationStyle="fullScreen"> so
 * the tab bar is never visible or interactive here.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CropFramerProps {
  /** Compressed image URI. */
  uri: string;
  /** Pixel dimensions of the (already compressed) image. */
  naturalWidth: number;
  naturalHeight: number;
  /** Called when user confirms the framing. */
  onConfirm: (focusX: number, focusY: number) => void;
  /** Called when user wants to go back without discarding the selection. */
  onBack: () => void;
  /**
   * Height of the crop viewport in logical px.
   * Defaults to the full screen height (feed-post framing).
   * Pass SCREEN_HEIGHT * 0.42 for hero-aspect avatar framing.
   */
  frameHeight?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// ─── CropFramer ───────────────────────────────────────────────────────────────

export default function CropFramer({
  uri,
  naturalWidth,
  naturalHeight,
  onConfirm,
  onBack,
  frameHeight: frameHeightProp,
}: CropFramerProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // The viewport we're framing for. Width is always the full screen width.
  const frameH = frameHeightProp ?? screenH;
  const isPartialFrame = frameH < screenH;

  // ── Cover-scale geometry ──────────────────────────────────────────────────
  // Scale so the image fully covers the frame viewport, then allow panning
  // along any axis that has overflow.
  const { scaledW, scaledH, overflowX, overflowY } = useMemo(() => {
    const scale   = Math.max(screenW / naturalWidth, frameH / naturalHeight);
    const scaledW = naturalWidth  * scale;
    const scaledH = naturalHeight * scale;
    return {
      scaledW,
      scaledH,
      overflowX: Math.max(0, scaledW - screenW),
      overflowY: Math.max(0, scaledH - frameH),
    };
  }, [screenW, frameH, naturalWidth, naturalHeight]);

  // Keep overflow in a ref so PanResponder closures always read the latest value.
  const overflowRef = useRef({ x: overflowX, y: overflowY });
  useEffect(() => {
    overflowRef.current = { x: overflowX, y: overflowY };
  }, [overflowX, overflowY]);

  // ── Pan state ─────────────────────────────────────────────────────────────
  // panX / panY: image translation from its centered position.
  // Range: [-overflow/2, +overflow/2] symmetric around center.
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;

  // Committed offset between gestures (gesture state resets on each touch).
  const baseOffset = useRef({ x: 0, y: 0 });

  // ── Hint opacity — fades to 0 on first drag ───────────────────────────────
  const hintOpacity  = useRef(new Animated.Value(1)).current;
  const hintFaded    = useRef(false);

  const fadeHint = useCallback(() => {
    if (hintFaded.current) return;
    hintFaded.current = true;
    Animated.timing(hintOpacity, {
      toValue:        0,
      duration:       500,
      useNativeDriver: true,
    }).start();
  }, [hintOpacity]);

  // ── Pan responder ─────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        overflowRef.current.x > 0 || overflowRef.current.y > 0,
      onMoveShouldSetPanResponder: () =>
        overflowRef.current.x > 0 || overflowRef.current.y > 0,
      onPanResponderMove: (_, gs) => {
        fadeHint();
        const { x: ox, y: oy } = overflowRef.current;
        if (ox > 0) panX.setValue(clamp(baseOffset.current.x + gs.dx, -ox / 2, ox / 2));
        if (oy > 0) panY.setValue(clamp(baseOffset.current.y + gs.dy, -oy / 2, oy / 2));
      },
      onPanResponderRelease: (_, gs) => {
        const { x: ox, y: oy } = overflowRef.current;
        baseOffset.current = {
          x: ox > 0 ? clamp(baseOffset.current.x + gs.dx, -ox / 2, ox / 2) : 0,
          y: oy > 0 ? clamp(baseOffset.current.y + gs.dy, -oy / 2, oy / 2) : 0,
        };
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  // ── Confirm handler ───────────────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    const { x: ox, y: oy } = overflowRef.current;
    // panX = (0.5 - focusX) * ox  →  focusX = 0.5 - panX / ox
    const fx = ox > 0 ? clamp(0.5 - baseOffset.current.x / ox, 0, 1) : 0.5;
    const fy = oy > 0 ? clamp(0.5 - baseOffset.current.y / oy, 0, 1) : 0.5;
    onConfirm(fx, fy);
  }, [onConfirm]);

  // ── Image position ────────────────────────────────────────────────────────
  // Image is positioned so the center of the frame is covered.
  const imageLeft = -overflowX / 2;
  const imageTop  = -overflowY / 2;

  const canPan = overflowX > 0 || overflowY > 0;

  // Corner bracket size (px).
  const BRACKET = 24;
  const THICK   = 3;

  // For a partial-height frame, the bottom-corner brackets are inset from
  // the frame bottom edge rather than the screen bottom edge.
  // bottom = screenH - frameH + CORNER_OFFSET positions them at the frame bottom.
  const CORNER_OFFSET = 12;
  const bottomCornerBottom = isPartialFrame
    ? screenH - frameH + CORNER_OFFSET
    : CORNER_OFFSET;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Draggable image — constrained to frame viewport ── */}
      <View
        style={[styles.frameInteraction, { height: frameH }]}
        {...panResponder.panHandlers}
      >
        <Animated.Image
          source={{ uri }}
          style={[
            styles.image,
            {
              width:  scaledW,
              height: scaledH,
              left:   imageLeft,
              top:    imageTop,
              transform: [
                { translateX: panX },
                { translateY: panY },
              ],
            },
          ]}
          resizeMode="cover"
        />
      </View>

      {/* ── Darkened overlay below the frame (avatar/hero framing) ── */}
      {isPartialFrame && (
        <View
          style={[
            styles.frameMask,
            { top: frameH },
          ]}
          pointerEvents="none"
        />
      )}

      {/* ── Frame boundary — corner brackets ─────────────────────────────── */}
      {/* The four corners mark the exact edge of the rendered viewport so
          the user knows precisely what will be visible in the hero/feed.    */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Top-left */}
        <View style={[styles.corner, styles.cornerTL, { top: CORNER_OFFSET, left: CORNER_OFFSET }]}>
          <View style={[styles.bracketH, { width: BRACKET, height: THICK }]} />
          <View style={[styles.bracketV, { width: THICK, height: BRACKET }]} />
        </View>
        {/* Top-right */}
        <View style={[styles.corner, styles.cornerTR, { top: CORNER_OFFSET, right: CORNER_OFFSET }]}>
          <View style={[styles.bracketH, { width: BRACKET, height: THICK }]} />
          <View style={[styles.bracketV, { width: THICK, height: BRACKET, alignSelf: 'flex-end' }]} />
        </View>
        {/* Bottom-left */}
        <View style={[styles.corner, styles.cornerBL, { bottom: bottomCornerBottom, left: CORNER_OFFSET }]}>
          <View style={[styles.bracketV, { width: THICK, height: BRACKET }]} />
          <View style={[styles.bracketH, { width: BRACKET, height: THICK }]} />
        </View>
        {/* Bottom-right */}
        <View style={[styles.corner, styles.cornerBR, { bottom: bottomCornerBottom, right: CORNER_OFFSET }]}>
          <View style={[styles.bracketV, { width: THICK, height: BRACKET, alignSelf: 'flex-end' }]} />
          <View style={[styles.bracketH, { width: BRACKET, height: THICK }]} />
        </View>
      </View>

      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={22} color="#F0F4F8" />
        </TouchableOpacity>

        <Text style={styles.title}>Frame your photo</Text>

        {/* Spacer to keep title centered */}
        <View style={styles.iconBtn} />
      </View>

      {/* ── Drag hint — fades after first drag ── */}
      {canPan && (
        <Animated.View
          style={[styles.hintWrap, { top: frameH / 2 - 16, opacity: hintOpacity }]}
          pointerEvents="none"
        >
          <Text style={styles.hint}>
            {overflowX > 0 && overflowY > 0
              ? 'Drag to adjust'
              : overflowX > 0
              ? 'Drag left / right to adjust'
              : 'Drag up / down to adjust'}
          </Text>
        </Animated.View>
      )}

      {/* ── Bottom bar ── */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        <Pressable
          style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
          onPress={handleConfirm}
          accessibilityRole="button"
          accessibilityLabel="Confirm framing"
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },

  // ── Frame interaction area (pan responder target, clipped to frame) ────────
  frameInteraction: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#000',
  },

  image: {
    position: 'absolute',
  },

  // ── Mask below the frame viewport ─────────────────────────────────────────
  frameMask: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },

  // ── Corner brackets ──────────────────────────────────────────────────────
  corner: {
    position: 'absolute',
    width: 36,
    height: 36,
  },
  cornerTL: { justifyContent: 'flex-start', alignItems: 'flex-start' },
  cornerTR: { justifyContent: 'flex-start', alignItems: 'flex-end' },
  cornerBL: { justifyContent: 'flex-end',   alignItems: 'flex-start' },
  cornerBR: { justifyContent: 'flex-end',   alignItems: 'flex-end' },
  bracketH: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 1.5,
    position: 'absolute',
  },
  bracketV: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 1.5,
    position: 'absolute',
  },

  // ── Top bar ───────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  title: {
    color: '#F0F4F8',
    fontSize: 15,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Hint ─────────────────────────────────────────────────────────────────
  hintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    color: 'rgba(255,255,255,0.90)',
    fontSize: 13,
    fontWeight: '500' as const,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: 'hidden',
  },

  // ── Bottom bar ────────────────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  doneBtn: {
    backgroundColor: '#2EBFA5',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  doneBtnPressed: {
    opacity: 0.8,
  },
  doneBtnText: {
    color: '#060B10',
    fontSize: 16,
    fontWeight: '700' as const,
  },
});
