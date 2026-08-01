/**
 * FrameRefiner — optional crop-rect refinement modal.
 *
 * Shows the full image with a translucent overlay and a highlighted crop-rect
 * window the user can pan and pinch. Includes a small live cover-preview inset.
 *
 * Zoom cap: minimum crop rect size = displayFrameWidth / naturalWidth so the
 * crop never upscales past ~1:1 pixel density.
 *
 * onConfirm(rect) returns the updated {x, y, w, h} (0–1 fractions).
 * If dismissed without confirming, the caller keeps its existing rect.
 *
 * No react-native-reanimated. Uses standard Animated + PanResponder only.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Image,
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
import type { CropRect } from '@/utils/computeAutoFrame';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FrameRefinerProps {
  uri: string;
  naturalWidth: number;
  naturalHeight: number;
  initialRect: CropRect;
  /** Starting fit mode; user can toggle between Crop (cover) and Fit (whole photo). */
  initialMode?: 'cover' | 'contain';
  onConfirm: (rect: CropRect, mode: 'cover' | 'contain') => void;
  onCancel: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// ─── FrameRefiner ─────────────────────────────────────────────────────────────

export default function FrameRefiner({
  uri,
  naturalWidth,
  naturalHeight,
  initialRect,
  initialMode = 'cover',
  onConfirm,
  onCancel,
}: FrameRefinerProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // ── Fit mode (Crop = cover / Fit = whole photo + blurred fill) ─────────────
  const [mode, setMode] = useState<'cover' | 'contain'>(initialMode);

  // ── Display geometry ──────────────────────────────────────────────────────
  const TOP_BAR_H    = insets.top + 56;
  const BOTTOM_BAR_H = Math.max(insets.bottom, 16) + 80;
  const displayH     = screenH - TOP_BAR_H - BOTTOM_BAR_H;

  const imgScale = Math.min(screenW / naturalWidth, displayH / naturalHeight);
  const imgW     = naturalWidth  * imgScale;
  const imgH     = naturalHeight * imgScale;
  const imgLeft  = (screenW - imgW) / 2;
  const imgTop   = TOP_BAR_H + (displayH - imgH) / 2;

  // ── Crop rect state (0–1 fractions) ──────────────────────────────────────
  const rectRef = useRef<CropRect>({ ...initialRect });
  const [rect, setRect] = useState<CropRect>({ ...initialRect });

  // ── Minimum crop rect (prevent upscaling past ~1:1) ───────────────────────
  const minCropW = screenW / naturalWidth;
  const minCropH = screenW / naturalHeight;

  // ── Convert fraction → display coords ────────────────────────────────────
  const toDisplay = useCallback(
    (r: CropRect) => ({
      left:   imgLeft + r.x * imgW,
      top:    imgTop  + r.y * imgH,
      width:  r.w * imgW,
      height: r.h * imgH,
    }),
    [imgLeft, imgTop, imgW, imgH],
  );

  // ── Pan + pinch responder — moves and scales the crop window ─────────────
  const panBase   = useRef({ x: 0, y: 0 });
  const pinchBase = useRef<{ dist: number; rect: CropRect } | null>(null);
  const imgGeom   = useRef({ imgW, imgH });
  imgGeom.current = { imgW, imgH };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          const t1 = touches[0];
          const t2 = touches[1];
          pinchBase.current = {
            dist: Math.hypot(t2.pageX - t1.pageX, t2.pageY - t1.pageY),
            rect: { ...rectRef.current },
          };
        } else {
          pinchBase.current = null;
          panBase.current = { x: rectRef.current.x, y: rectRef.current.y };
        }
      },

      onPanResponderMove: (evt, gs) => {
        const touches = evt.nativeEvent.touches;

        if (touches.length >= 2) {
          // ── Pinch: scale the crop rect around its own center ──────────────
          const t1 = touches[0];
          const t2 = touches[1];
          const dist = Math.hypot(t2.pageX - t1.pageX, t2.pageY - t1.pageY);
          const pb = pinchBase.current;
          if (!pb || pb.dist <= 0) return;

          const scale = dist / pb.dist;
          const base  = pb.rect;
          const { minCropW: mcw, minCropH: mch } = minRef.current;

          // Scale around the base rect's center, clamped to source resolution cap.
          const cw  = clamp(base.w / scale, mcw, 1);
          const ch  = clamp(base.h / scale, mch, 1);
          const ccx = base.x + base.w / 2;
          const ccy = base.y + base.h / 2;
          const nx  = clamp(ccx - cw / 2, 0, 1 - cw);
          const ny  = clamp(ccy - ch / 2, 0, 1 - ch);

          const next = { x: nx, y: ny, w: cw, h: ch };
          rectRef.current = next;
          setRect({ ...next });
        } else {
          // ── Pan: translate the crop window ────────────────────────────────
          // Reset pinch base if we transitioned from two touches to one.
          if (pinchBase.current) {
            pinchBase.current = null;
            panBase.current = { x: rectRef.current.x, y: rectRef.current.y };
            return;
          }
          const { imgW: iw, imgH: ih } = imgGeom.current;
          const r  = rectRef.current;
          const dx = gs.dx / iw;
          const dy = gs.dy / ih;
          const nx = clamp(panBase.current.x + dx, 0, 1 - r.w);
          const ny = clamp(panBase.current.y + dy, 0, 1 - r.h);
          const next = { ...r, x: nx, y: ny };
          rectRef.current = next;
          setRect({ ...next });
        }
      },

      onPanResponderRelease: () => {
        pinchBase.current = null;
      },
    }),
  ).current;

  // ── Corner resize responders ──────────────────────────────────────────────
  // Each corner stores its own base rect and reads from imgGeom for dimensions.
  type Corner = 'tl' | 'tr' | 'bl' | 'br';

  const makeCornerBase = () => ({ rect: { ...initialRect } });

  const tlBase = useRef(makeCornerBase());
  const trBase = useRef(makeCornerBase());
  const blBase = useRef(makeCornerBase());
  const brBase = useRef(makeCornerBase());

  const minRef = useRef({ minCropW, minCropH });
  minRef.current = { minCropW, minCropH };

  const makeCornerResponder = useCallback((corner: Corner, base: React.MutableRefObject<{ rect: CropRect }>) => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderGrant: () => {
        base.current.rect = { ...rectRef.current };
      },
      onPanResponderMove: (_, gs) => {
        const { imgW: iw, imgH: ih } = imgGeom.current;
        const { minCropW: mcw, minCropH: mch } = minRef.current;
        const dx = gs.dx / iw;
        const dy = gs.dy / ih;
        const r  = base.current.rect;

        let { x, y, w, h } = r;

        if (corner === 'tl' || corner === 'tr') {
          const newY = clamp(y + dy, 0, y + h - mch);
          const dh   = y - newY;
          y = newY;
          h = clamp(h + dh, mch, 1);
        } else {
          h = clamp(h + dy, mch, 1 - y);
        }

        if (corner === 'tl' || corner === 'bl') {
          const newX = clamp(x + dx, 0, x + w - mcw);
          const dw   = x - newX;
          x = newX;
          w = clamp(w + dw, mcw, 1);
        } else {
          w = clamp(w + dx, mcw, 1 - x);
        }

        const next = { x, y, w, h };
        rectRef.current = next;
        setRect({ ...next });
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create corner responders once on mount.
  const tlResponder = useRef(makeCornerResponder('tl', tlBase)).current;
  const trResponder = useRef(makeCornerResponder('tr', trBase)).current;
  const blResponder = useRef(makeCornerResponder('bl', blBase)).current;
  const brResponder = useRef(makeCornerResponder('br', brBase)).current;

  // ── Confirm ───────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    onConfirm({ ...rectRef.current }, mode);
  }, [onConfirm, mode]);

  // ── Rendered crop rect in display coordinates ─────────────────────────────
  const displayRect = useMemo(() => toDisplay(rect), [rect, toDisplay]);

  const HANDLE = 22;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Full image */}
      <Image
        source={{ uri }}
        style={[
          styles.image,
          { left: imgLeft, top: imgTop, width: imgW, height: imgH },
        ]}
        resizeMode="contain"
      />

      {/* Dark overlay — four rects around the crop window */}
      <View pointerEvents="none" style={[styles.overlay, { left: 0, top: imgTop, width: screenW, height: displayRect.top - imgTop }]} />
      <View pointerEvents="none" style={[styles.overlay, { left: 0, top: displayRect.top + displayRect.height, width: screenW, height: imgTop + imgH - (displayRect.top + displayRect.height) }]} />
      <View pointerEvents="none" style={[styles.overlay, { left: imgLeft, top: displayRect.top, width: displayRect.left - imgLeft, height: displayRect.height }]} />
      <View pointerEvents="none" style={[styles.overlay, { left: displayRect.left + displayRect.width, top: displayRect.top, width: imgLeft + imgW - (displayRect.left + displayRect.width), height: displayRect.height }]} />

      {/* Crop window border */}
      <View pointerEvents="none" style={[styles.cropBorder, { left: displayRect.left, top: displayRect.top, width: displayRect.width, height: displayRect.height }]} />

      {/* Pan target (move the window) */}
      <View
        style={[styles.panTarget, {
          left:   displayRect.left + HANDLE,
          top:    displayRect.top  + HANDLE,
          width:  Math.max(0, displayRect.width  - HANDLE * 2),
          height: Math.max(0, displayRect.height - HANDLE * 2),
        }]}
        {...panResponder.panHandlers}
      />

      {/* Corner resize handles */}
      <View style={[styles.handle, { left: displayRect.left - HANDLE / 2, top: displayRect.top - HANDLE / 2 }]} {...tlResponder.panHandlers} />
      <View style={[styles.handle, { left: displayRect.left + displayRect.width - HANDLE / 2, top: displayRect.top - HANDLE / 2 }]} {...trResponder.panHandlers} />
      <View style={[styles.handle, { left: displayRect.left - HANDLE / 2, top: displayRect.top + displayRect.height - HANDLE / 2 }]} {...blResponder.panHandlers} />
      <View style={[styles.handle, { left: displayRect.left + displayRect.width - HANDLE / 2, top: displayRect.top + displayRect.height - HANDLE / 2 }]} {...brResponder.panHandlers} />

      {/* Live preview inset */}
      <PreviewInset uri={uri} rect={rect} naturalWidth={naturalWidth} naturalHeight={naturalHeight} top={insets.top + 60} />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onCancel} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="x" size={22} color="#F0F4F8" />
        </TouchableOpacity>
        <Text style={styles.title}>Adjust framing</Text>
        <View style={styles.iconBtn} />
      </View>

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
        {/* Crop / Fit mode segmented toggle */}
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

        <Pressable
          style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
          onPress={handleConfirm}
          accessibilityRole="button"
          accessibilityLabel="Apply framing"
        >
          <Text style={styles.doneBtnText}>Apply</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── PreviewInset ─────────────────────────────────────────────────────────────

interface PreviewInsetProps {
  uri: string;
  rect: CropRect;
  naturalWidth: number;
  naturalHeight: number;
  top: number;
}

function PreviewInset({ uri, rect, naturalWidth, naturalHeight, top }: PreviewInsetProps) {
  const PREVIEW_SIZE = 80;

  const scaleX = PREVIEW_SIZE / (rect.w * naturalWidth);
  const scaleY = PREVIEW_SIZE / (rect.h * naturalHeight);
  const scale  = Math.max(scaleX, scaleY);

  const scaledW = naturalWidth  * scale;
  const scaledH = naturalHeight * scale;
  const offsetX = -rect.x * naturalWidth  * scale;
  const offsetY = -rect.y * naturalHeight * scale;

  return (
    <View style={[styles.previewBox, { top, width: PREVIEW_SIZE, height: PREVIEW_SIZE }]} pointerEvents="none">
      <Image
        source={{ uri }}
        style={{ position: 'absolute', width: scaledW, height: scaledH, left: offsetX, top: offsetY }}
        resizeMode="cover"
      />
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
  overlay: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  cropBorder: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  panTarget: {
    position: 'absolute',
  },
  handle: {
    position: 'absolute',
    width: 22,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 4,
  },
  previewBox: {
    position: 'absolute',
    right: 12,
    overflow: 'hidden',
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
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
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
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
  // Crop / Fit segmented toggle
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
});
