/**
 * CropEditor — unified crop/frame editor for compose and avatar edit.
 *
 * Model: fixed crop window (at targetAspect) centred on screen.
 * The user pans and pinch-zooms the image underneath — "Instagram model".
 *
 * Touch  : PanResponder for single-finger pan and two-finger pinch-to-zoom.
 * Web    : same PanResponder (RN Web uses pointer events), plus
 *          native wheel event for scroll-to-zoom (attached via ref).
 *
 * Zoom range: 1× (image just covers the crop window) → 8× that scale.
 * No react-native-reanimated — standard Animated / PanResponder only.
 *
 * onConfirm(rect, mode) returns a CropRect (0–1 fractions of the
 * natural image) and the selected mode.
 * In contain mode the rect is {x:0,y:0,w:1,h:1} — FocalImage ignores it.
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
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
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
  /** When true, hide the Crop / Fit toggle (avatar is always cover). */
  hideModetoggle?: boolean;
  /** Top-bar title string. */
  title?: string;
  /** Leading button icon. 'back' (←) or 'cancel' (×). Default 'cancel'. */
  cancelIcon?: 'back' | 'cancel';
  onConfirm: (rect: CropRect, mode: 'cover' | 'contain') => void;
  onCancel: () => void;
}

// ─── Pure geometry helpers ─────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Clamp offset so the image always covers the crop window with no gaps. */
function clampOffset(
  offset: { x: number; y: number },
  scale: number,
  cropW: number,
  cropH: number,
  nw: number,
  nh: number,
): { x: number; y: number } {
  const maxX = Math.max(0, (scale * nw - cropW) / 2);
  const maxY = Math.max(0, (scale * nh - cropH) / 2);
  return { x: clamp(offset.x, -maxX, maxX), y: clamp(offset.y, -maxY, maxY) };
}

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
  // Top-left of the image, relative to the crop-window top-left:
  const imgLeft = displayW / 2 - cropW / 2 - offset.x;
  const imgTop  = displayH / 2 - cropH / 2 - offset.y;
  return {
    x: clamp(imgLeft / displayW, 0, 1),
    y: clamp(imgTop  / displayH, 0, 1),
    w: clamp(cropW / displayW, 0, 1),
    h: clamp(cropH / displayH, 0, 1),
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
  const sw = cropW / (rect.w * nw);
  const sh = cropH / (rect.h * nh);
  const scale = clamp(Math.max(sw, sh), minScale, maxScale);
  // Rect centre displacement from the image centre (in [−0.5, 0.5]).
  const cx = rect.x + rect.w / 2 - 0.5;
  const cy = rect.y + rect.h / 2 - 0.5;
  const offset = { x: -cx * scale * nw, y: -cy * scale * nh };
  return { scale, offset: clampOffset(offset, scale, cropW, cropH, nw, nh) };
}

// ─── CropEditor ───────────────────────────────────────────────────────────────

export default function CropEditor({
  uri,
  naturalWidth,
  naturalHeight,
  targetAspect,
  initialRect,
  initialMode = 'cover',
  hideModetoggle = false,
  title = 'Adjust photo',
  cancelIcon = 'cancel',
  onConfirm,
  onCancel,
}: CropEditorProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<'cover' | 'contain'>(initialMode);

  // ── Layout ─────────────────────────────────────────────────────────────────
  const TOP_BAR_H    = insets.top + 56;
  const BOTTOM_BAR_H = Math.max(insets.bottom, 16) + (hideModetoggle ? 80 : 116);
  const availW = screenW;
  const availH = screenH - TOP_BAR_H - BOTTOM_BAR_H;

  // Crop window: target aspect, maximised to fill available space.
  const { cropW, cropH } = useMemo(() => {
    const byW = { cropW: availW, cropH: availW / targetAspect };
    if (byW.cropH <= availH) return byW;
    return { cropW: availH * targetAspect, cropH: availH };
  }, [availW, availH, targetAspect]);

  // Centre of the crop window in screen coordinates.
  const cropCX = screenW / 2;
  const cropCY = TOP_BAR_H + availH / 2;

  // ── Scale limits ───────────────────────────────────────────────────────────
  const minScale = Math.max(cropW / naturalWidth, cropH / naturalHeight);
  const maxScale = minScale * 8;  // 8× zoom range

  // ── Initial state (computed once on mount) ─────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initState = useMemo(() => {
    if (initialRect && initialRect.w > 0 && initialRect.h > 0) {
      return rectToState(
        initialRect, cropW, cropH, naturalWidth, naturalHeight, minScale, maxScale,
      );
    }
    return { scale: minScale, offset: { x: 0, y: 0 } };
  }, []); // run exactly once — captures mount-time geometry

  // ── State: refs = gesture truth, useState = render driver ─────────────────
  const scaleRef  = useRef(initState.scale);
  const offsetRef = useRef(initState.offset);
  const [renderScale,  setRenderScale]  = useState(initState.scale);
  const [renderOffset, setRenderOffset] = useState(initState.offset);

  /** Commit new scale+offset to both refs and render state. */
  const commit = useCallback((s: number, o: { x: number; y: number }) => {
    scaleRef.current  = s;
    offsetRef.current = o;
    setRenderScale(s);
    setRenderOffset({ ...o });
  }, []);

  // Live refs read by gesture handlers and the wheel listener.
  const cropRef     = useRef({ cropW, cropH, cropCX, cropCY });
  cropRef.current   = { cropW, cropH, cropCX, cropCY };
  const limRef      = useRef({ minScale, maxScale });
  limRef.current    = { minScale, maxScale };
  const natRef      = useRef({ nw: naturalWidth, nh: naturalHeight });
  natRef.current    = { nw: naturalWidth, nh: naturalHeight };
  const commitRef   = useRef(commit);
  commitRef.current = commit;

  // Re-clamp when the crop window or zoom limits change (e.g. orientation flip).
  useEffect(() => {
    const s = clamp(scaleRef.current, minScale, maxScale);
    const o = clampOffset(offsetRef.current, s, cropW, cropH, naturalWidth, naturalHeight);
    commit(s, o);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minScale, maxScale, cropW, cropH]);

  // ── Gesture base state ─────────────────────────────────────────────────────
  type PanBase   = { type: 'pan';   startOffset: { x: number; y: number } };
  type PinchBase = {
    type:        'pinch';
    startDist:   number;
    startScale:  number;
    startOffset: { x: number; y: number };
    /** Pinch midpoint relative to crop-window centre (screen px). */
    midX: number;
    midY: number;
  };
  const gestureBase = useRef<PanBase | PinchBase | null>(null);

  // ── PanResponder ───────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (evt) => {
        const ts = evt.nativeEvent.touches;
        if (ts && ts.length >= 2) {
          const t1 = ts[0], t2 = ts[1];
          gestureBase.current = {
            type:        'pinch',
            startDist:   Math.hypot(t2.pageX - t1.pageX, t2.pageY - t1.pageY),
            startScale:  scaleRef.current,
            startOffset: { ...offsetRef.current },
            midX: (t1.pageX + t2.pageX) / 2 - cropRef.current.cropCX,
            midY: (t1.pageY + t2.pageY) / 2 - cropRef.current.cropCY,
          };
        } else {
          gestureBase.current = {
            type:        'pan',
            startOffset: { ...offsetRef.current },
          };
        }
      },

      onPanResponderMove: (evt, gs) => {
        const base = gestureBase.current;
        if (!base) return;
        const { cropW: cw, cropH: ch } = cropRef.current;
        const { minScale: minS, maxScale: maxS } = limRef.current;
        const { nw, nh } = natRef.current;

        const ts = evt.nativeEvent.touches;

        if (ts && ts.length >= 2 && base.type === 'pinch') {
          const t1 = ts[0], t2 = ts[1];
          const dist = Math.hypot(t2.pageX - t1.pageX, t2.pageY - t1.pageY);
          if (base.startDist <= 0) return;

          const newScale = clamp(base.startScale * (dist / base.startDist), minS, maxS);

          // Keep the image point under the pinch midpoint stationary.
          const { midX, midY, startOffset, startScale } = base;
          const imgPtX = (midX - startOffset.x) / (startScale * nw);
          const imgPtY = (midY - startOffset.y) / (startScale * nh);
          const newOffset = {
            x: midX - imgPtX * newScale * nw,
            y: midY - imgPtY * newScale * nh,
          };
          const clamped = clampOffset(newOffset, newScale, cw, ch, nw, nh);
          scaleRef.current  = newScale;
          offsetRef.current = clamped;
          setRenderScale(newScale);
          setRenderOffset({ ...clamped });

        } else if (base.type === 'pan') {
          const newOffset = {
            x: base.startOffset.x + gs.dx,
            y: base.startOffset.y + gs.dy,
          };
          const clamped = clampOffset(newOffset, scaleRef.current, cw, ch, nw, nh);
          offsetRef.current = clamped;
          setRenderOffset({ ...clamped });
        }
      },

      onPanResponderRelease: () => {
        gestureBase.current = null;
      },
    }),
  ).current;

  // ── Web scroll-to-zoom ─────────────────────────────────────────────────────
  const outerRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = outerRef.current as unknown as HTMLElement | null;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const { cropW: cw, cropH: ch } = cropRef.current;
      const { minScale: minS, maxScale: maxS } = limRef.current;
      const { nw, nh } = natRef.current;

      const factor   = Math.exp(-e.deltaY * 0.002);
      const s        = scaleRef.current;
      const newScale = clamp(s * factor, minS, maxS);

      // Zoom toward the cursor position.
      const elRect = el.getBoundingClientRect();
      const { cropCX: ccx, cropCY: ccy } = cropRef.current;
      const curX = e.clientX - elRect.left  - ccx;
      const curY = e.clientY - elRect.top   - ccy;

      const o = offsetRef.current;
      const imgPtX = (curX - o.x) / (s * nw);
      const imgPtY = (curY - o.y) / (s * nh);
      const newOffset = {
        x: curX - imgPtX * newScale * nw,
        y: curY - imgPtY * newScale * nh,
      };
      const clamped = clampOffset(newOffset, newScale, cw, ch, nw, nh);
      scaleRef.current  = newScale;
      offsetRef.current = clamped;
      setRenderScale(newScale);
      setRenderOffset({ ...clamped });
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []); // refs handle dynamic values; this only needs to run on mount

  // ── Image position (cover mode) ────────────────────────────────────────────
  const imgStyle = useMemo(() => {
    const displayW = renderScale * naturalWidth;
    const displayH = renderScale * naturalHeight;
    return {
      position: 'absolute' as const,
      width:    displayW,
      height:   displayH,
      left:     cropCX - displayW / 2 + renderOffset.x,
      top:      cropCY - displayH / 2 + renderOffset.y,
    };
  }, [renderScale, renderOffset, cropCX, cropCY, naturalWidth, naturalHeight]);

  // ── Contain mode image (whole photo fit to available space) ────────────────
  const containImgStyle = useMemo(() => {
    if (mode !== 'contain') return null;
    const scale = Math.min(availW / naturalWidth, availH / naturalHeight);
    const w = naturalWidth  * scale;
    const h = naturalHeight * scale;
    return {
      position: 'absolute' as const,
      width:  w,
      height: h,
      left:   (availW - w) / 2,
      top:    TOP_BAR_H + (availH - h) / 2,
    };
  }, [mode, availW, availH, TOP_BAR_H, naturalWidth, naturalHeight]);

  // ── Confirm ────────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    if (mode === 'contain') {
      onConfirm({ x: 0, y: 0, w: 1, h: 1 }, 'contain');
      return;
    }
    const { cropW: cw, cropH: ch } = cropRef.current;
    const { nw, nh } = natRef.current;
    const rect = stateToRect(scaleRef.current, offsetRef.current, cw, ch, nw, nh);
    onConfirm(rect, 'cover');
  }, [mode, onConfirm]);

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
        /* ── Cover mode: panning image + crop window overlay ────────────────── */
        <>
          {/* The photo — pans and zooms under the crop window */}
          <Image source={{ uri }} style={imgStyle} resizeMode="cover" />

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

          {/* Gesture target — full screen so any touch drives the image */}
          <View style={[StyleSheet.absoluteFill, styles.gestureTarget]} {...panResponder.panHandlers} />
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
  gestureTarget: {
    // transparent; exists only to receive gestures across the whole screen
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
});
