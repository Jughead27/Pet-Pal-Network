/**
 * CropEditor — unified crop/frame editor for compose and avatar edit.
 *
 * Model: fixed crop window (at targetAspect) centred on screen.
 * The user pans and pinch-zooms the image underneath — "Instagram model".
 *
 * Gestures : react-native-gesture-handler Pan + Pinch via GestureDetector.
 *             Both run as Reanimated worklets on the UI thread — no JS-bridge
 *             jank during gestures.
 *   Pan  — single-finger drag in any direction (maxPointers: 1).
 *   Pinch — two-finger zoom toward the pinch midpoint (natural focal-point math).
 *   Simultaneous() lets both be registered; maxPointers(1) on Pan makes them
 *   naturally exclusive by finger count.
 *
 * Web desktop : GestureDetector (Pointer Events) + native wheel for scroll-to-zoom.
 * Web Safari  : gesturestart/gesturechange listeners prevent native page-zoom
 *               (Safari ignores touch-action:none for pinch in some iOS versions).
 *
 * Zoom range: 1× (image just covers the crop window) → 8× that scale.
 *
 * Reanimated/gesture-handler setup notes:
 *   — GestureHandlerRootView is already in app/_layout.tsx; nothing to add.
 *   — babel-preset-expo (Expo 54) includes the Reanimated worklet transform
 *     automatically; no explicit plugin entry in babel.config.js is required.
 *
 * onConfirm(rect, mode) returns a CropRect (0–1 fractions of the natural image)
 * and the selected mode. In contain mode the rect is {x:0,y:0,w:1,h:1}.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Image,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, X } from 'phosphor-react-native';
import type { CropRect } from '@/utils/computeAutoFrame';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CropEditorProps {
  uri: string;
  naturalWidth: number;
  naturalHeight: number;
  /**
   * Target display aspect ratio (width / height).
   * compose: feedAspect   avatar: containerWidth / containerHeight
   */
  targetAspect: number;
  /** Initial crop rect in 0–1 fractions. null → cover the window from centre. */
  initialRect?: CropRect | null;
  /** Initial mode. Default 'cover'. */
  initialMode?: 'cover' | 'contain';
  /**
   * When true, shows a 3-option aspect-ratio picker (1:1 / 4:5 / Original)
   * and picks a smart default based on photo orientation.
   * Use for compose; avatar stays locked to its targetAspect.
   */
  showAspectPicker?: boolean;
  /** When true, hide the Crop / Fit toggle (avatar is always cover). */
  hideModetoggle?: boolean;
  /** Top-bar title string. */
  title?: string;
  /** Leading button icon. 'back' (←) or 'cancel' (×). Default 'cancel'. */
  cancelIcon?: 'back' | 'cancel';
  onConfirm: (rect: CropRect, mode: 'cover' | 'contain') => void;
  onCancel: () => void;
}

// ─── Worklet-safe geometry helpers ────────────────────────────────────────────
// The 'worklet' directive lets these run on the UI thread inside gesture
// callbacks AND on the JS thread everywhere else — one implementation, both
// contexts.

const clamp = (v: number, lo: number, hi: number): number => {
  'worklet';
  return Math.max(lo, Math.min(hi, v));
};

/**
 * Clamp offset so the image always covers the crop window — no empty gaps.
 * Accepts scalars rather than an object so worklet allocation stays minimal.
 */
const clampOffset = (
  ox: number,
  oy: number,
  scale: number,
  cropW: number,
  cropH: number,
  nw: number,
  nh: number,
): { x: number; y: number } => {
  'worklet';
  const maxX = Math.max(0, (scale * nw - cropW) / 2);
  const maxY = Math.max(0, (scale * nh - cropH) / 2);
  return { x: clamp(ox, -maxX, maxX), y: clamp(oy, -maxY, maxY) };
};

// ─── JS-thread-only geometry helpers ─────────────────────────────────────────

/** Convert (scale, offset) → CropRect in natural-image fractions. */
function stateToRect(
  scale: number,
  offset: { x: number; y: number },
  cropW: number,
  cropH: number,
  nw: number,
  nh: number,
): CropRect {
  const displayW = scale * nw;
  const displayH = scale * nh;
  const imgLeft  = displayW / 2 - cropW / 2 - offset.x;
  const imgTop   = displayH / 2 - cropH / 2 - offset.y;
  return {
    x: clamp(imgLeft / displayW, 0, 1),
    y: clamp(imgTop  / displayH, 0, 1),
    w: clamp(cropW   / displayW, 0, 1),
    h: clamp(cropH   / displayH, 0, 1),
  };
}

/** Convert an existing CropRect → (scale, offset) that reproduces it. */
function rectToState(
  rect: CropRect,
  cropW: number,
  cropH: number,
  nw: number,
  nh: number,
  minScale: number,
  maxScale: number,
): { scale: number; offset: { x: number; y: number } } {
  const sw    = cropW / (rect.w * nw);
  const sh    = cropH / (rect.h * nh);
  const scale = clamp(Math.max(sw, sh), minScale, maxScale);
  const cx    = rect.x + rect.w / 2 - 0.5;
  const cy    = rect.y + rect.h / 2 - 0.5;
  const off   = clampOffset(-cx * scale * nw, -cy * scale * nh, scale, cropW, cropH, nw, nh);
  return { scale, offset: off };
}

// ─── CropEditor ───────────────────────────────────────────────────────────────

export default function CropEditor({
  uri,
  naturalWidth,
  naturalHeight,
  targetAspect,
  initialRect,
  initialMode = 'cover',
  showAspectPicker = false,
  hideModetoggle = false,
  title = 'Adjust photo',
  cancelIcon = 'cancel',
  onConfirm,
  onCancel,
}: CropEditorProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<'cover' | 'contain'>(initialMode);

  // ── Aspect-ratio picker (compose only) ────────────────────────────────────
  // Three fixed options: square, portrait standard, and the photo's own ratio.
  const ratioOptions = useMemo(() => [
    { label: '1:1',      value: 1 },
    { label: '4:5',      value: 4 / 5 },
    { label: 'Original', value: naturalWidth / naturalHeight },
  ], [naturalWidth, naturalHeight]);

  // Smart default: landscape photos open in their own ratio; portrait/square → 4:5.
  const [activeAspect, setActiveAspect] = useState<number>(() => {
    if (!showAspectPicker) return targetAspect;
    return (naturalWidth / naturalHeight) > 1
      ? naturalWidth / naturalHeight   // landscape → original ratio
      : 4 / 5;                         // portrait / square → 4:5
  });

  // ── Layout ─────────────────────────────────────────────────────────────────
  const TOP_BAR_H    = insets.top + 56;
  const BOTTOM_BAR_H = Math.max(insets.bottom, 16) + (hideModetoggle ? 80 : 116);
  const availW = screenW;
  const availH = screenH - TOP_BAR_H - BOTTOM_BAR_H;

  // Crop window: active aspect (picker-selected or locked targetAspect), maximised.
  const aspect = showAspectPicker ? activeAspect : targetAspect;
  const { cropW, cropH } = useMemo(() => {
    const byW = { cropW: availW, cropH: availW / aspect };
    if (byW.cropH <= availH) return byW;
    return { cropW: availH * aspect, cropH: availH };
  }, [availW, availH, aspect]);

  // Centre of the crop window in screen coordinates.
  const cropCX = screenW / 2;
  const cropCY = TOP_BAR_H + availH / 2;

  // ── Scale limits ───────────────────────────────────────────────────────────
  const minScale = Math.max(cropW / naturalWidth, cropH / naturalHeight);
  const maxScale = minScale * 8;

  // ── Initial state (computed once on mount) ─────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initState = useMemo(() => {
    if (initialRect && initialRect.w > 0 && initialRect.h > 0) {
      return rectToState(initialRect, cropW, cropH, naturalWidth, naturalHeight, minScale, maxScale);
    }
    return { scale: minScale, offset: { x: 0, y: 0 } };
  }, []); // intentionally empty — captures mount-time geometry only

  // ── Shared values: gesture truth (UI thread) ───────────────────────────────
  const scale   = useSharedValue(initState.scale);
  const offsetX = useSharedValue(initState.offset.x);
  const offsetY = useSharedValue(initState.offset.y);

  // Saved at gesture-start; gesture worklets compute deltas from these.
  const savedScale   = useSharedValue(initState.scale);
  const savedOffsetX = useSharedValue(initState.offset.x);
  const savedOffsetY = useSharedValue(initState.offset.y);

  // Pinch focal point relative to crop-window centre, recorded on gesture start.
  const pinchFocalX = useSharedValue(0);
  const pinchFocalY = useSharedValue(0);

  // Layout constants that worklets need to read.
  // Written from the JS thread in useEffect; read on the UI thread in worklets.
  const cropWV  = useSharedValue(cropW);
  const cropHV  = useSharedValue(cropH);
  const minSV   = useSharedValue(minScale);
  const maxSV   = useSharedValue(maxScale);
  const nwV     = useSharedValue(naturalWidth);
  const nhV     = useSharedValue(naturalHeight);
  const cropCXV = useSharedValue(cropCX);
  const cropCYV = useSharedValue(cropCY);

  // Keep layout shared values in sync with JS-thread layout math, and
  // re-clamp scale/offset when geometry changes (e.g. orientation flip).
  useEffect(() => {
    cropWV.value  = cropW;
    cropHV.value  = cropH;
    minSV.value   = minScale;
    maxSV.value   = maxScale;
    cropCXV.value = cropCX;
    cropCYV.value = cropCY;

    const s   = Math.max(minScale, Math.min(maxScale, scale.value));
    const off = clampOffset(offsetX.value, offsetY.value, s, cropW, cropH, naturalWidth, naturalHeight);
    scale.value   = s;
    offsetX.value = off.x;
    offsetY.value = off.y;
    // scale/offsetX/offsetY are stable shared-value references, not reactive deps.
    // naturalWidth/naturalHeight are static props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minScale, maxScale, cropW, cropH, cropCX, cropCY]);

  // ── Aspect change: reset image to fill-and-centre for the new frame ──────
  const handleAspectChange = useCallback((newAspect: number) => {
    // Compute the new crop window geometry (same logic as cropW/cropH useMemo).
    const byW = { cropW: availW, cropH: availW / newAspect };
    const newCropW = byW.cropH <= availH ? byW.cropW : availH * newAspect;
    const newCropH = byW.cropH <= availH ? byW.cropH : availH;
    const newMin   = Math.max(newCropW / naturalWidth, newCropH / naturalHeight);
    const newMax   = newMin * 8;

    // Prime shared values immediately so worklets see correct geometry
    // before the re-render from setActiveAspect completes.
    cropWV.value  = newCropW;
    cropHV.value  = newCropH;
    minSV.value   = newMin;
    maxSV.value   = newMax;

    // Reset zoom and pan: fill the new frame centred.
    scale.value        = newMin;
    offsetX.value      = 0;
    offsetY.value      = 0;
    savedScale.value   = newMin;
    savedOffsetX.value = 0;
    savedOffsetY.value = 0;

    setActiveAspect(newAspect);
  }, [
    availW, availH, naturalWidth, naturalHeight,
    cropWV, cropHV, minSV, maxSV,
    scale, offsetX, offsetY, savedScale, savedOffsetX, savedOffsetY,
  ]);

  // ── Gesture: single-finger pan ─────────────────────────────────────────────
  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)   // fails when a second finger appears → Pinch takes over
    .onBegin(() => {
      savedOffsetX.value = offsetX.value;
      savedOffsetY.value = offsetY.value;
    })
    .onUpdate((e) => {
      const off = clampOffset(
        savedOffsetX.value + e.translationX,
        savedOffsetY.value + e.translationY,
        scale.value,
        cropWV.value, cropHV.value,
        nwV.value, nhV.value,
      );
      offsetX.value = off.x;
      offsetY.value = off.y;
    });

  // ── Gesture: two-finger pinch-to-zoom ─────────────────────────────────────
  // onStart (not onBegin) fires when the pinch is officially recognised with
  // both fingers tracked, giving a valid focalX/focalY midpoint.
  const pinchGesture = Gesture.Pinch()
    .onStart((e) => {
      savedScale.value   = scale.value;
      savedOffsetX.value = offsetX.value;
      savedOffsetY.value = offsetY.value;
      // Focal point relative to crop-window centre (screen px).
      pinchFocalX.value  = e.focalX - cropCXV.value;
      pinchFocalY.value  = e.focalY - cropCYV.value;
    })
    .onUpdate((e) => {
      const ss  = savedScale.value;
      const nw  = nwV.value;
      const nh  = nhV.value;
      const fX  = pinchFocalX.value;
      const fY  = pinchFocalY.value;
      const sox = savedOffsetX.value;
      const soy = savedOffsetY.value;

      const newScale = clamp(ss * e.scale, minSV.value, maxSV.value);

      // Keep the image point that was under the pinch midpoint stationary.
      // Compute where that point sits in normalised image coords:
      const imgPtX = (fX - sox) / (ss * nw);
      const imgPtY = (fY - soy) / (ss * nh);
      // Then find the offset that puts it back under the same focal point
      // at the new scale:
      const newOx = fX - imgPtX * newScale * nw;
      const newOy = fY - imgPtY * newScale * nh;

      const off = clampOffset(newOx, newOy, newScale, cropWV.value, cropHV.value, nw, nh);
      scale.value   = newScale;
      offsetX.value = off.x;
      offsetY.value = off.y;
    });

  // Simultaneous: both gestures are registered; they are naturally exclusive
  // because Pan has maxPointers(1) and Pinch requires 2 fingers.
  const composed = Gesture.Simultaneous(panGesture, pinchGesture);

  // ── Animated style: image position (cover mode) ───────────────────────────
  const animatedImgStyle = useAnimatedStyle(() => {
    const s        = scale.value;
    const displayW = s * nwV.value;
    const displayH = s * nhV.value;
    return {
      position: 'absolute' as const,
      width:    displayW,
      height:   displayH,
      left:     cropCXV.value - displayW / 2 + offsetX.value,
      top:      cropCYV.value - displayH / 2 + offsetY.value,
    };
  });

  // ── Contain-mode image (whole photo fit to available space) ───────────────
  const containImgStyle = useMemo(() => {
    if (mode !== 'contain') return null;
    const s = Math.min(availW / naturalWidth, availH / naturalHeight);
    const w = naturalWidth  * s;
    const h = naturalHeight * s;
    return {
      position: 'absolute' as const,
      width:  w,
      height: h,
      left:   (availW - w) / 2,
      top:    TOP_BAR_H + (availH - h) / 2,
    };
  }, [mode, availW, availH, TOP_BAR_H, naturalWidth, naturalHeight]);

  // ── Web: scroll-to-zoom + Safari pinch suppression ────────────────────────
  const outerRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = outerRef.current as unknown as HTMLElement | null;
    if (!el) return;

    // Wheel: scroll-to-zoom on desktop web (writes directly to shared values).
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s        = scale.value;
      const factor   = Math.exp(-e.deltaY * 0.002);
      const newScale = Math.max(minSV.value, Math.min(maxSV.value, s * factor));
      const elRect   = el.getBoundingClientRect();
      const curX     = e.clientX - elRect.left  - cropCXV.value;
      const curY     = e.clientY - elRect.top   - cropCYV.value;
      const ox       = offsetX.value;
      const oy       = offsetY.value;
      const nw       = nwV.value;
      const nh       = nhV.value;
      const imgPtX   = (curX - ox) / (s * nw);
      const imgPtY   = (curY - oy) / (s * nh);
      const off = clampOffset(
        curX - imgPtX * newScale * nw,
        curY - imgPtY * newScale * nh,
        newScale,
        cropWV.value, cropHV.value,
        nw, nh,
      );
      scale.value   = newScale;
      offsetX.value = off.x;
      offsetY.value = off.y;
    };

    // gesturestart / gesturechange: non-standard Safari events that fire for
    // native pinch-to-zoom. Preventing them is the only reliable way to stop
    // Safari from zooming the page even when touch-action:none is applied,
    // because iOS handles pinch at the OS level before Pointer Events fire.
    const onGestureEvent = (e: Event) => e.preventDefault();

    el.addEventListener('wheel',         onWheel,        { passive: false });
    // TypeScript doesn't know these Safari-specific events; cast the options.
    el.addEventListener('gesturestart',  onGestureEvent, { passive: false } as AddEventListenerOptions);
    el.addEventListener('gesturechange', onGestureEvent, { passive: false } as AddEventListenerOptions);

    return () => {
      el.removeEventListener('wheel',         onWheel);
      el.removeEventListener('gesturestart',  onGestureEvent);
      el.removeEventListener('gesturechange', onGestureEvent);
    };
    // Shared-value references are stable; layout values are read via .value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Confirm ────────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    if (mode === 'contain') {
      onConfirm({ x: 0, y: 0, w: 1, h: 1 }, 'contain');
      return;
    }
    const rect = stateToRect(
      scale.value,
      { x: offsetX.value, y: offsetY.value },
      cropW, cropH, naturalWidth, naturalHeight,
    );
    onConfirm(rect, 'cover');
  }, [mode, onConfirm, cropW, cropH, naturalWidth, naturalHeight, scale, offsetX, offsetY]);

  const isContain = mode === 'contain';

  return (
    <View ref={outerRef} style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {isContain ? (
        /* ── Contain mode: whole photo + blur fill ──────────────────────────── */
        <>
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            blurRadius={20}
          />
          {containImgStyle && (
            <Image source={{ uri }} style={containImgStyle} resizeMode="contain" />
          )}
        </>
      ) : (
        /* ── Cover mode: panning/zooming image + crop window overlay ─────────── */
        <>
          {/* The photo — animated by Reanimated on the UI thread */}
          <Animated.Image
            source={{ uri }}
            style={animatedImgStyle}
            resizeMode="cover"
          />

          {/* Dark overlay in 4 rects surrounding the crop window */}
          <View pointerEvents="none" style={[styles.overlay, {
            left: 0, top: 0, width: screenW, height: cropCY - cropH / 2,
          }]} />
          <View pointerEvents="none" style={[styles.overlay, {
            left: 0, top: cropCY + cropH / 2,
            width: screenW, height: screenH - (cropCY + cropH / 2),
          }]} />
          <View pointerEvents="none" style={[styles.overlay, {
            left: 0, top: cropCY - cropH / 2,
            width: cropCX - cropW / 2, height: cropH,
          }]} />
          <View pointerEvents="none" style={[styles.overlay, {
            left: cropCX + cropW / 2, top: cropCY - cropH / 2,
            width: screenW - (cropCX + cropW / 2), height: cropH,
          }]} />

          {/* Crop window border */}
          <View pointerEvents="none" style={[styles.cropBorder, {
            left:   cropCX - cropW / 2,
            top:    cropCY - cropH / 2,
            width:  cropW,
            height: cropH,
          }]} />

          {/* Gesture surface — full screen so any touch drives the image.
              GestureDetector automatically sets touch-action:none on its
              child, preventing browser scroll/zoom interference. */}
          <GestureDetector gesture={composed}>
            <View style={StyleSheet.absoluteFill} />
          </GestureDetector>

          {/* Aspect-ratio picker — floats just below the crop-frame border.
              Rendered after GestureDetector so it sits on top and receives taps. */}
          {showAspectPicker && (
            <View
              pointerEvents="box-none"
              style={[styles.ratioPicker, { top: cropCY + cropH / 2 + 10 }]}
            >
              {/* Dark pill scrim keeps labels legible against any photo background */}
              <View style={styles.ratioScrim}>
                {ratioOptions.map((opt) => {
                  const active = Math.abs(activeAspect - opt.value) < 0.005;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      onPress={() => handleAspectChange(opt.value)}
                      hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={opt.label}
                    >
                      <Text style={[styles.ratioLabel, active && styles.ratioLabelActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </>
      )}

      {/* ── Top bar ── */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onCancel}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={cancelIcon === 'back' ? 'Back' : 'Cancel'}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {cancelIcon === 'back'
            ? <ArrowLeft size={22} color="#F0F4F8" weight="regular" />
            : <X         size={22} color="#F0F4F8" weight="regular" />}
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.iconBtn} />
      </View>

      {/* ── Bottom bar ── */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        {!hideModetoggle && (
          <View style={styles.modeToggle}>
            <Pressable
              style={[styles.modeBtn, mode === 'cover' && styles.modeBtnActive]}
              onPress={() => setMode('cover')}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === 'cover' }}
              accessibilityLabel="Crop"
            >
              <Text style={[styles.modeBtnText, mode === 'cover' && styles.modeBtnTextActive]}>
                Crop
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeBtn, mode === 'contain' && styles.modeBtnActive]}
              onPress={() => setMode('contain')}
              accessibilityRole="radio"
              accessibilityState={{ checked: mode === 'contain' }}
              accessibilityLabel="Fit — show whole photo"
            >
              <Text style={[styles.modeBtnText, mode === 'contain' && styles.modeBtnTextActive]}>
                Fit
              </Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
          onPress={handleConfirm}
          accessibilityRole="button"
          accessibilityLabel="Apply framing"
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
  overlay: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  cropBorder: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  topBar: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
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
  bottomBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  modeToggle: {
    flexDirection: 'row' as const,
    marginBottom: 12,
    borderRadius: 10,
    overflow: 'hidden' as const,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center' as const,
  },
  modeBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  modeBtnText: {
    color: 'rgba(240,244,248,0.6)',
    fontSize: 14,
    fontWeight: '600' as const,
  },
  modeBtnTextActive: {
    color: '#F0F4F8',
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

  // Aspect-ratio picker
  ratioPicker: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    alignItems: 'center' as const,  // centres the pill horizontally
  },
  ratioScrim: {
    flexDirection: 'row' as const,
    gap: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  ratioLabel: {
    color: 'rgba(240,244,248,0.45)',
    fontSize: 12,
    fontWeight: '400' as const,
    letterSpacing: 0.6,
  },
  ratioLabelActive: {
    color: '#F0F4F8',
    fontWeight: '600' as const,
  },
});
