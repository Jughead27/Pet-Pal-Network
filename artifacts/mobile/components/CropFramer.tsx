/**
 * CropFramer — full-screen WYSIWYG framing step.
 *
 * Shows the photo at full-screen cover-fit. The user drags along whichever
 * axis has overflow to choose what part of the photo will appear in the feed.
 * The "frame" they see IS the feed frame — same width × height, same cover scale.
 *
 * On "Done" it calls onConfirm(focusX, focusY) with values in [0, 1].
 * focusX = 0.5, focusY = 0.5 means center (default cover behavior).
 *
 * No react-native-reanimated. Uses standard Animated + PanResponder.
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
  /** Called when user wants to go back / change photo. */
  onBack: () => void;
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
}: CropFramerProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // ── Cover-scale geometry ──────────────────────────────────────────────────
  const { scaledW, scaledH, overflowX, overflowY } = useMemo(() => {
    const scale   = Math.max(screenW / naturalWidth, screenH / naturalHeight);
    const scaledW = naturalWidth  * scale;
    const scaledH = naturalHeight * scale;
    return {
      scaledW,
      scaledH,
      overflowX: Math.max(0, scaledW - screenW),
      overflowY: Math.max(0, scaledH - screenH),
    };
  }, [screenW, screenH, naturalWidth, naturalHeight]);

  // Keep overflow in a ref so PanResponder closures always read the latest value.
  const overflowRef = useRef({ x: overflowX, y: overflowY });
  useEffect(() => {
    overflowRef.current = { x: overflowX, y: overflowY };
  }, [overflowX, overflowY]);

  // ── Pan state ─────────────────────────────────────────────────────────────
  // panX/panY are the image's translation FROM its centered position.
  // Range: [-overflow/2, +overflow/2]  (symmetric around center)
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;

  // Committed offset between gestures (gesture state resets on each touch).
  const baseOffset = useRef({ x: 0, y: 0 });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        overflowRef.current.x > 0 || overflowRef.current.y > 0,
      onMoveShouldSetPanResponder: () =>
        overflowRef.current.x > 0 || overflowRef.current.y > 0,
      onPanResponderMove: (_, gs) => {
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
    // Convert pan offset back to focal point.
    // panX = (0.5 - focusX) * ox  →  focusX = 0.5 - panX / ox
    const fx = ox > 0 ? clamp(0.5 - baseOffset.current.x / ox, 0, 1) : 0.5;
    const fy = oy > 0 ? clamp(0.5 - baseOffset.current.y / oy, 0, 1) : 0.5;
    onConfirm(fx, fy);
  }, [onConfirm]);

  // ── Image position ────────────────────────────────────────────────────────
  // Base: image top-left at (-overflowX/2, -overflowY/2) so it's centered.
  // Translation: panX shifts away from center.
  const imageLeft = -overflowX / 2;
  const imageTop  = -overflowY / 2;

  const canPan = overflowX > 0 || overflowY > 0;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* ── Draggable image ── */}
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
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

      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="arrow-left" size={22} color="#F0F4F8" />
        </TouchableOpacity>

        <Text style={styles.title}>Frame your photo</Text>

        {/* Spacer to keep title centered */}
        <View style={styles.iconBtn} />
      </View>

      {/* ── Hint ── */}
      {canPan && (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hint}>Drag to adjust</Text>
        </View>
      )}

      {/* ── Bottom bar ── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
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
  image: {
    position: 'absolute',
  },
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
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  title: {
    color: '#F0F4F8',
    fontSize: 15,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    alignItems: 'center',
    marginTop: -14,
  },
  hint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '500' as const,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    overflow: 'hidden',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  doneBtn: {
    backgroundColor: '#2EBFA5',
    borderRadius: 12,
    paddingVertical: 15,
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
