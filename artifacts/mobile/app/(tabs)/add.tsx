/**
 * Add tab — image upload + post creation.
 *
 * Flow:
 *   1. If the user owns no pets → prompt linking to pet creation.
 *   2. Pick a photo from the camera roll (expo-image-picker).
 *   3. Compress to max 2048 px longest edge as JPEG (compressImage util).
 *   4. Auto-frame: compute a suggested crop rect automatically, jump to form.
 *   5. Form: caption + pet selector + nursery toggle + "show whole photo" toggle.
 *      - "Adjust framing" tappable opens FrameRefiner modal for manual refinement.
 *   6. Submit: presign → PUT to R2 → POST /posts → invalidate feed → Home.
 *
 * No react-native-reanimated. Works on web, iOS, and Android.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { CameraSlash, Crop, ArrowClockwise, Camera, CaretRight, ImageSquare } from 'phosphor-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import Button from '@/components/Button';
import {
  useGetMyPets,
  usePresignUpload,
  useVerifyUpload,
  useCreatePost,
  useSearchPets,
  getSearchPetsQueryKey,
  getGetFeedQueryKey,
} from '@workspace/api-client-react';
import type { Pet } from '@workspace/api-client-react';
import { compressImage } from '@/utils/compressImage';
import { computeAverageColor } from '@/utils/luminance';
import { computeFillThumb } from '@/utils/fillThumb';
import CropEditor from '@/components/CropEditor';
import FocalImage from '@/components/FocalImage';
import PetAvatar from '@/components/PetAvatar';
import { computeAutoFrame } from '@/utils/computeAutoFrame';
import type { CropRect } from '@/utils/computeAutoFrame';
import { signalPostSuccess } from '@/utils/feedScrollSignal';
import { getFeedCellDimensions } from '@/utils/feedCellDimensions';

// ─────────────────────────────────────────────────────────────────────────────

type AddStep = 'idle' | 'compressing' | 'form';

export default function AddScreen() {
  const colors       = useColors();
  const insets       = useSafeAreaInsets();
  const queryClient  = useQueryClient();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const topInset     = Platform.OS === 'web' ? 67 : insets.top;
  const isWeb        = Platform.OS === 'web';

  // Feed cell aspect ratio — use the live measured value from the last rendered
  // FeedPage (exact). Falls back to a formula if the feed has never rendered yet
  // (e.g. user opens Add before the home feed has loaded even once).
  //
  // The fallback approximates how index.tsx sizes each page:
  //   • web:    effectivePageHeight = windowHeight (tab bar is position:absolute)
  //   • native: measured height ≈ windowHeight − statusBar (insets.top)
  //
  // This constant is read once per render. The measurement is always available
  // by the time a typical user reaches the compose flow (they visit Home first).
  const _measured   = getFeedCellDimensions();
  const feedAspect  = _measured
    ? _measured.w / _measured.h
    : Platform.OS === 'web'
      ? screenW / screenH                           // web: windowHeight ≈ screenH
      : screenW / Math.max(1, screenH - insets.top); // native: subtract status bar

  // Preview container sized by the CONFIRMED crop rect's own aspect
  // (rect.w × naturalW / rect.h × naturalH) — same pattern as post detail's
  // hasFullCropRect + rect-aspect container. Falls back to feedAspect before
  // a rect exists. Both dimensions are computed explicitly — do NOT combine
  // aspectRatio with maxHeight; Yoga clamps height only and silently changes
  // the ratio. (previewW/previewH are assigned below, after cropRect state.)

  // The web tab bar is position:absolute with minHeight:84 (set in _layout.tsx).
  const WEB_TAB_BAR_HEIGHT = 84;

  // ── Server state ──────────────────────────────────────────────────────────
  const { data: myPetsData, isLoading: petsLoading } = useGetMyPets();
  const pets = myPetsData?.pets ?? [];

  // ── Local state ───────────────────────────────────────────────────────────
  const [step,          setStep]          = useState<AddStep>('idle');
  const [compressedUri, setCompressedUri] = useState<string | null>(null);
  const naturalSize = useRef({ width: 0, height: 0 });
  const [caption,       setCaption]       = useState('');
  const [selectedPetIds, setSelectedPetIds] = useState<Set<string>>(new Set());
  const [petSearchQuery, setPetSearchQuery] = useState('');
  // "Tag another pet" is secondary — collapsed by default; expands on tap.
  const [tagExpanded,    setTagExpanded]    = useState(false);
  const [isNursery,      setIsNursery]     = useState(false);
  const [isUploading,   setIsUploading]   = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // Legacy focal point — derived from rect center for backward compat.
  const [cropFocusX,    setCropFocusX]    = useState(0.5);
  const [cropFocusY,    setCropFocusY]    = useState(0.5);

  // New crop rect + mode.
  const [cropRect,      setCropRect]      = useState<CropRect | null>(null);
  const [cropMode,      setCropMode]      = useState<'cover' | 'contain'>('contain');
  // Average color sampled from the photo — fills frame space the photo doesn't
  // cover when zoomed out past the old floor. Persisted with the post so every
  // surface (editor, feed, detail, share cards) renders the identical fill.
  const [cropFillColor, setCropFillColor] = useState<string | null>(null);
  // Tiny thumbnail data URI — stretched under the photo on static surfaces
  // for a blurred-looking fill. Sampled alongside the fill color.
  const [cropFillThumb, setCropFillThumb] = useState<string | null>(null);
  // Monotonic token: ignores stale async color-sample completions after the
  // user swaps photos mid-sample.
  const fillColorToken = useRef(0);

  // ── Preview container dimensions (rect-aspect; see comment above) ────────
  const natW = naturalSize.current.width;
  const natH = naturalSize.current.height;
  const rectAspect =
    cropRect && cropRect.w > 0 && cropRect.h > 0 && natW > 0 && natH > 0
      ? (cropRect.w * natW) / Math.max(cropRect.h * natH, 1e-6)
      : feedAspect;
  const previewMaxW = Math.min(screenW - 48, 480); // stay inside scroll padding
  let previewH = Math.round(screenH * 0.40);       // ~40 % of viewport (cap)
  let previewW = Math.round(previewH * rectAspect);
  if (previewW > previewMaxW) {
    previewW = Math.round(previewMaxW);
    previewH = Math.round(previewW / rectAspect);
  }

  // Refiner modal visibility.
  const [refinerOpen,   setRefinerOpen]   = useState(false);

  // Source-picker overlay — shown by "Change photo" so the user can swap the
  // image without losing caption / pet selection or resetting to the idle step.
  const [isChangingPhoto, setIsChangingPhoto] = useState(false);

  // Auto-select the only own pet when there is exactly one.
  useEffect(() => {
    if (pets.length === 1) setSelectedPetIds(new Set([pets[0].id]));
  }, [pets]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const { mutateAsync: presignUpload } = usePresignUpload();
  const { mutateAsync: verifyUpload  } = useVerifyUpload();
  const { mutateAsync: createPost    } = useCreatePost();

  // ── Image pipeline ────────────────────────────────────────────────────────
  // Compress → auto-frame → jump straight to form.
  const processPickedAsset = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    setCompressedUri(null);
    // Clear any previous photo's fill color immediately and bump the token so
    // an in-flight sample for the OLD photo can't overwrite the new one.
    setCropFillColor(null);
    setCropFillThumb(null);
    fillColorToken.current += 1;
    setStep('compressing');
    setIsChangingPhoto(false); // dismiss source-picker overlay the moment processing starts
    try {
      const compressed = await compressImage(asset.uri, asset.width, asset.height);
      const uri = compressed.uri;
      const w   = (compressed as { width?: number }).width  ?? asset.width;
      const h   = (compressed as { height?: number }).height ?? asset.height;

      setCompressedUri(uri);
      naturalSize.current = { width: w, height: h };

      // Auto-frame: compute suggested rect (non-blocking, falls back to floor).
      // Use the feed hero's aspect ratio (full-screen portrait) as the target.
      const rect = await computeAutoFrame(uri, w, h, feedAspect);
      setCropRect(rect);
      // Derive focal point from rect center for backward compat.
      setCropFocusX(rect.x + rect.w / 2);
      setCropFocusY(rect.y + rect.h / 2);
      setCropMode('cover');
      setStep('form');

      // Sample the photo's average color (same technique as the share-card
      // bar theming) — used as the fill behind the photo if the user zooms
      // out past cover in Adjust. Non-blocking here; submit re-checks and
      // awaits sampling when the framing actually needs a fill.
      const token = fillColorToken.current;
      computeAverageColor(uri)
        .then((c) => { if (fillColorToken.current === token) setCropFillColor(c); })
        .catch(() => { if (fillColorToken.current === token) setCropFillColor(null); });
      // Tiny blur thumbnail — same token guard; null on failure (solid-color
      // fill remains the fallback everywhere).
      computeFillThumb(uri)
        .then((t) => { if (fillColorToken.current === token) setCropFillThumb(t); })
        .catch(() => { if (fillColorToken.current === token) setCropFillThumb(null); });
    } catch {
      setError('Failed to process image. Please try another photo.');
      setStep('idle');
    }
  }, [feedAspect]);

  // ── Image picking — library ────────────────────────────────────────────────
  const pickImage = useCallback(async () => {
    setError(null);

    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setError('Photo library access is required. Please enable it in Settings.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const mime  = asset.mimeType ?? '';
    if (mime && !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      setError('Only JPEG, PNG, and WebP images are supported.');
      return;
    }
    if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
      setError('This photo is too large (max 10 MB). Please choose a smaller image.');
      return;
    }

    await processPickedAsset(asset);
    // Skip the intermediate preview screen — open Adjust directly after picking.
    setRefinerOpen(true);
  }, [processPickedAsset]);

  // ── Image capture — camera (native only) ──────────────────────────────────
  const captureImage = useCallback(async () => {
    setError(null);

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError(
        'Camera access is turned off for pshpsh. To take a photo, go to ' +
        'Settings → pshpsh → Camera and enable it. You can still choose a ' +
        'photo from your library below.',
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const mime  = asset.mimeType ?? '';
    if (mime && !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      setError('Only JPEG, PNG, and WebP images are supported.');
      return;
    }
    if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
      setError('This photo is too large (max 10 MB). Please choose a smaller image.');
      return;
    }

    await processPickedAsset(asset);
  }, [processPickedAsset]);

  // ── Refiner callbacks ─────────────────────────────────────────────────────
  const handleRefineConfirm = useCallback((rect: CropRect, mode: 'cover' | 'contain') => {
    if (mode === 'contain') {
      // Fit: legacy contain path — no crop rect, no fill, centered focal point.
      // Clearing the rect guarantees no state leakage from a previous ratio
      // selection and routes every surface through the legacy contain renderer.
      setCropRect(null);
      setCropFocusX(0.5);
      setCropFocusY(0.5);
      setCropMode('contain');
      setRefinerOpen(false);
      return;
    }
    setCropRect(rect);
    setCropFocusX(rect.x + rect.w / 2);
    setCropFocusY(rect.y + rect.h / 2);
    setCropMode(mode);
    setRefinerOpen(false);
  }, []);

  const handleRefineCancel = useCallback(() => {
    setRefinerOpen(false);
  }, []);

  // ── Compose cancel ────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    setStep('idle');
    setCompressedUri(null);
    setCaption('');
    setIsNursery(false);
    setTagExpanded(false);
    setCropFocusX(0.5);
    setCropFocusY(0.5);
    setCropRect(null);
    setCropMode('cover');
    setCropFillColor(null);
    setRefinerOpen(false);
    setError(null);
    setPetSearchQuery('');
    if (pets.length === 1) setSelectedPetIds(new Set([pets[0].id]));
    else setSelectedPetIds(new Set());
    router.navigate('/');
  }, [pets.length]);

  // ── Submit ────────────────────────────────────────────────────────────────
  // ── Pet search ────────────────────────────────────────────────────────────
  // Searches other users' pets to tag alongside own pets.
  const excludeParam = [...selectedPetIds].join(',');
  const { data: petSearchData } = useSearchPets(
    { q: petSearchQuery, exclude: excludeParam },
    { query: { enabled: petSearchQuery.trim().length >= 1, queryKey: getSearchPetsQueryKey({ q: petSearchQuery, exclude: excludeParam }) } },
  );
  const petSearchResults = petSearchData?.pets ?? [];

  // Own pets first in the petIds array (petIds[0] must be caller-owned).
  const hasOwnPetSelected = [...selectedPetIds].some(id => pets.some(p => p.id === id));

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!compressedUri || selectedPetIds.size === 0 || !hasOwnPetSelected || isUploading) return;
    setIsUploading(true);
    setError(null);

    try {
      const imageResponse = await fetch(compressedUri);
      const blob          = await imageResponse.blob();

      if (blob.size > 10 * 1024 * 1024) {
        setError('This photo is too large (max 10 MB). Please choose a smaller image.');
        setIsUploading(false);
        return;
      }

      const { uploadUrl, mediaKey } = await presignUpload({
        data: { contentType: 'image/jpeg', sizeBytes: blob.size },
      });

      const putRes = await fetch(uploadUrl, {
        method:  'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body:    blob,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      // Server-side magic-byte check — real security boundary.
      await verifyUpload({ data: { mediaKey } });

      const ownedPetIds  = [...selectedPetIds].filter(id => pets.some(p => p.id === id));
      const otherPetIds  = [...selectedPetIds].filter(id => !pets.some(p => p.id === id));
      const orderedPetIds = [...ownedPetIds, ...otherPetIds];

      // When the framing extends past the image (zoomed out below cover),
      // the sampled fill color is REQUIRED for WYSIWYG — if the async sample
      // hasn't resolved yet (fast posters), await it now before creating.
      const needsFill = !!cropRect && (
        cropRect.x < 0 || cropRect.y < 0 ||
        cropRect.x + cropRect.w > 1 || cropRect.y + cropRect.h > 1
      );
      let effectiveFillColor: string | null = cropFillColor;
      if (needsFill && !effectiveFillColor && compressedUri) {
        effectiveFillColor = await computeAverageColor(compressedUri).catch(() => null);
      }
      // Blur thumbnail is best-effort: await it only when a fill is actually
      // needed and the async sample hasn't landed yet; null = solid fallback.
      let effectiveFillThumb: string | null = cropFillThumb;
      if (needsFill && !effectiveFillThumb && compressedUri) {
        effectiveFillThumb = await computeFillThumb(compressedUri).catch(() => null);
      }

      await createPost({
        data: {
          petIds:     orderedPetIds,
          mediaKey,
          caption:    caption.trim() || undefined,
          isNursery,
          // Legacy focal point (backward compat).
          cropFocusX,
          cropFocusY,
          // New crop rect + mode.
          cropMode:   cropMode,
          cropX:      cropRect?.x ?? null,
          cropY:      cropRect?.y ?? null,
          cropW:      cropRect?.w ?? null,
          cropH:      cropRect?.h ?? null,
          // Sampled fill color — only meaningful when the rect extends past
          // the image (zoomed out); harmless otherwise. Fit (contain) posts
          // never use the fill system — send null like legacy posts.
          cropFillColor: cropMode === 'contain' ? null : effectiveFillColor,
          cropFillThumb: needsFill ? effectiveFillThumb : null,
        },
      });

      signalPostSuccess();
      queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });

      // Reset form.
      setCompressedUri(null);
      setCaption('');
      setIsNursery(false);
      setCropFocusX(0.5);
      setCropFocusY(0.5);
      setCropRect(null);
      setCropMode('cover');
      setCropFillColor(null);
      setCropFillThumb(null);
      setPetSearchQuery('');
      setTagExpanded(false);
      setStep('idle');
      if (pets.length === 1) setSelectedPetIds(new Set([pets[0].id]));
      else setSelectedPetIds(new Set());

      router.navigate('/');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setIsUploading(false);
    }
  }, [
    compressedUri, selectedPetIds, hasOwnPetSelected, isUploading, presignUpload, createPost,
    caption, isNursery, cropFocusX, cropFocusY, cropRect, cropMode, cropFillColor, cropFillThumb,
    queryClient, pets,
  ]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const canSubmit = !!compressedUri && selectedPetIds.size > 0 && hasOwnPetSelected && !isUploading;
  // Derive the primary selected pet so we can personalise the caption placeholder.
  const selectedPet = pets.find((p) => selectedPetIds.has(p.id)) ?? null;

  // Caption placeholder — playful, pet-as-author voice, rotating.
  // Template index is picked once per compose open (mount) and stays stable
  // for the session; only the pet name slot changes when the user picks a pet.
  const CAPTION_TEMPLATES = [
    (name: string) => `What's ${name} thinking?`,
    (name: string) => `What's ${name} up to?`,
    (name: string) => `A word from ${name}…`,
  ] as const;
  const placeholderIdxRef = useRef(Math.floor(Math.random() * CAPTION_TEMPLATES.length));
  const captionPlaceholder = CAPTION_TEMPLATES[placeholderIdxRef.current](
    selectedPet ? selectedPet.name : 'your pet',
  );
  const s = makeStyles(colors);

  // ── Render ────────────────────────────────────────────────────────────────

  if (petsLoading) {
    return (
      <View style={[s.fill, s.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (pets.length === 0) {
    return (
      <View style={[s.fill, s.centered, { backgroundColor: colors.background, paddingTop: topInset }]}>
        <CameraSlash size={36} color={colors.mutedForeground} weight="regular" style={{ marginBottom: 16 }} />
        <Text style={[s.emptyTitle, { color: colors.foreground }]}>No pets yet</Text>
        <Text style={[s.emptySub, { color: colors.mutedForeground }]}>
          Create a pet profile before posting.
        </Text>
        <Button
          variant="primary"
          label="Create a pet"
          onPress={() => router.push('/pet/create')}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[s.fill, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* ── Change Photo source picker ──────────────────────────────────────── */}
      {/*
       * Rendered as a bottom-sheet modal so the user can pick a replacement
       * photo without losing their caption or pet selection.  If they cancel
       * the native picker (or tap the backdrop), they land straight back on
       * the form step — no state is cleared.  `processPickedAsset` resets
       * isChangingPhoto as soon as a new photo starts processing.
       */}
      <Modal
        visible={isChangingPhoto}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setIsChangingPhoto(false)}
      >
        <View style={s.changePhotoOverlay}>
          <Pressable
            style={s.changePhotoBackdrop}
            onPress={() => setIsChangingPhoto(false)}
            accessibilityLabel="Keep current photo"
          />
          <View style={[s.changePhotoSheet, { backgroundColor: colors.background }]}>
            <View style={[s.changePhotoHandle, { backgroundColor: colors.border }]} />
            <View style={[s.sourceCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 0 }]}>
              {Platform.OS !== 'web' && (
                <>
                  <TouchableOpacity
                    style={s.sourceRow}
                    onPress={captureImage}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Take a photo"
                  >
                    <Camera size={22} color={colors.foreground} weight="regular" />
                    <Text style={[s.sourceRowText, { color: colors.foreground }]}>Take a photo</Text>
                    <CaretRight size={18} color={colors.mutedForeground} weight="regular" />
                  </TouchableOpacity>
                  <View style={[s.sourceDivider, { backgroundColor: colors.border }]} />
                </>
              )}
              <TouchableOpacity
                style={s.sourceRow}
                onPress={pickImage}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Choose from library"
              >
                <ImageSquare size={22} color={colors.foreground} weight="regular" />
                <Text style={[s.sourceRowText, { color: colors.foreground }]}>Choose from library</Text>
                <CaretRight size={18} color={colors.mutedForeground} weight="regular" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[s.changePhotoCancel, { borderColor: colors.border }]}
              onPress={() => setIsChangingPhoto(false)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Keep current photo"
            >
              <Text style={[s.changePhotoCancelText, { color: colors.mutedForeground }]}>Keep current photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Crop Editor modal ─────────────────────────────────────────────── */}
      <Modal
        visible={refinerOpen && !!compressedUri && !!cropRect}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={handleRefineCancel}
      >
        {compressedUri && cropRect ? (
          <CropEditor
            uri={compressedUri}
            naturalWidth={naturalSize.current.width  || 1}
            naturalHeight={naturalSize.current.height || 1}
            initialRect={cropRect}
            targetAspect={feedAspect}
            showAspectPicker
            initialMode={cropMode}
            title="Adjust framing"
            cancelIcon="back"
            allowZoomOut
            fillColor={cropFillColor}
            onConfirm={handleRefineConfirm}
            onCancel={handleRefineCancel}
          />
        ) : null}
      </Modal>

      <ScrollView
        style={s.fill}
        contentContainerStyle={[
          s.scroll,
          {
            paddingTop: topInset + 16,
            paddingBottom: isWeb ? 80 + WEB_TAB_BAR_HEIGHT : 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.headingRow}>
          <Text style={[s.heading, { color: colors.foreground }]}>New Post</Text>
          <Button
            variant="quiet"
            label="Cancel"
            onPress={handleCancel}
            disabled={isUploading}
          />
        </View>

        {/* ── Image area ── */}
        {step === 'compressing' ? (
          <View style={[
            s.imagePlaceholder,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              width: previewW,
              height: previewH,
              alignSelf: 'center',
            },
          ]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[s.processingText, { color: colors.mutedForeground }]}>Processing…</Text>
          </View>
        ) : compressedUri ? (
          // Preview is an explicitly-sized scaled feed cell.
          // Controls sit in a clean row BELOW the portrait preview so they
          // are never clipped by the overflow:hidden wrapper.
          <>
            <View style={[
              s.previewWrapper,
              {
                width: previewW,
                height: previewH,
                alignSelf: 'center',
              },
            ]}>
              <FocalImage
                source={{ uri: compressedUri }}
                style={s.preview}
                focusX={cropFocusX}
                focusY={cropFocusY}
                cropX={cropRect?.x ?? null}
                cropY={cropRect?.y ?? null}
                cropW={cropRect?.w ?? null}
                cropH={cropRect?.h ?? null}
                mode={cropMode}
                cropFillColor={cropFillColor}
                naturalWidth={naturalSize.current.width || null}
                naturalHeight={naturalSize.current.height || null}
              />
            </View>
            {/* Controls row — below the preview, never clips */}
            <View style={[
              s.previewControls,
              {
                width: previewW,
                alignSelf: 'center',
                backgroundColor: colors.secondary,
                borderColor: colors.border,
              },
            ]}>
              <TouchableOpacity
                style={s.previewControlBtn}
                onPress={() => setRefinerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Adjust framing"
              >
                <Crop size={13} color={colors.mutedForeground} weight="regular" />
                <Text style={[s.previewControlText, { color: colors.mutedForeground }]}>Adjust</Text>
              </TouchableOpacity>
              <View style={[s.previewControlDivider, { backgroundColor: colors.border }]} />
              <TouchableOpacity
                style={s.previewControlBtn}
                onPress={() => setIsChangingPhoto(true)}
                accessibilityRole="button"
                accessibilityLabel="Change photo"
              >
                <ArrowClockwise size={13} color={colors.mutedForeground} weight="regular" />
                <Text style={[s.previewControlText, { color: colors.mutedForeground }]}>Change photo</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          // ── Source selection ──────────────────────────────────────────────
          <View style={[s.sourceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {Platform.OS !== 'web' && (
              <>
                <TouchableOpacity
                  style={s.sourceRow}
                  onPress={captureImage}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Take a photo"
                >
                  <Camera size={22} color={colors.foreground} weight="regular" />
                  <Text style={[s.sourceRowText, { color: colors.foreground }]}>Take a photo</Text>
                  <CaretRight size={18} color={colors.mutedForeground} weight="regular" />
                </TouchableOpacity>
                <View style={[s.sourceDivider, { backgroundColor: colors.border }]} />
              </>
            )}
            <TouchableOpacity
              style={s.sourceRow}
              onPress={pickImage}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add a photo"
            >
              <ImageSquare size={22} color={colors.foreground} weight="regular" />
              <Text style={[s.sourceRowText, { color: colors.foreground }]}>Add a photo</Text>
              <CaretRight size={18} color={colors.mutedForeground} weight="regular" />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Form ── */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Pet — FIRST: the pet is the post's identity */}
          <Text style={[s.label, { color: colors.mutedForeground }]}>Your pets</Text>

          {/* Own-pet chips — always multi-select toggles */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.petScroll}>
            {pets.map((pet) => (
              <PetChip
                key={pet.id}
                pet={pet}
                selected={selectedPetIds.has(pet.id)}
                colors={colors}
                onPress={() => {
                  setSelectedPetIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(pet.id)) {
                      // Require at least one own pet to stay selected
                      const ownSelected = [...next].filter(id => pets.some(p => p.id === id));
                      if (ownSelected.length <= 1) return prev;
                      next.delete(pet.id);
                    } else {
                      next.add(pet.id);
                    }
                    return next;
                  });
                }}
              />
            ))}
          </ScrollView>

          {/* Caption — directly after Your pets; placeholder personalises once pet is chosen */}
          <Text style={[s.label, { color: colors.mutedForeground, marginTop: 16 }]}>Caption</Text>
          <TextInput
            style={[s.input, s.captionInput, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }]}
            value={caption}
            onChangeText={setCaption}
            placeholder={captionPlaceholder}
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            multiline
            returnKeyType="done"
            blurOnSubmit
            maxLength={250}
          />

          {/* Tag another pet — secondary: collapsed accordion (matches the
              socials pattern on profile edit); search reveals on tap only. */}
          <TouchableOpacity
            onPress={() => setTagExpanded((v) => !v)}
            activeOpacity={0.7}
            style={s.tagToggle}
            accessibilityRole="button"
            accessibilityLabel={tagExpanded ? 'Collapse tag another pet' : 'Tag another pet'}
          >
            <Text style={[s.tagToggleText, { color: colors.mutedForeground }]}>
              {tagExpanded ? 'Hide tag another pet' : '+ Tag another pet'}
            </Text>
            <Text style={[s.tagToggleCaret, { color: colors.mutedForeground }]}>
              {tagExpanded ? '↑' : '↓'}
            </Text>
          </TouchableOpacity>

          {tagExpanded && (
            <TextInput
              style={[s.input, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }]}
              value={petSearchQuery}
              onChangeText={setPetSearchQuery}
              placeholder="Search by pet or owner name…"
              placeholderTextColor={colors.mutedForeground}
              selectionColor={colors.primary}
              autoCapitalize="none"
              returnKeyType="search"
            />
          )}
          {tagExpanded && petSearchResults.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.petScroll}>
              {petSearchResults
                .filter((r) => !selectedPetIds.has(r.id) && !pets.some(p => p.id === r.id))
                .map((result) => (
                  <TouchableOpacity
                    key={result.id}
                    style={[s.searchResultChip, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                    onPress={() => {
                      setSelectedPetIds((prev) => new Set([...prev, result.id]));
                      setPetSearchQuery('');
                    }}
                  >
                    <Text style={[s.searchResultName, { color: colors.foreground }]}>
                      {result.name}
                    </Text>
                    <Text style={[s.searchResultOwner, { color: colors.mutedForeground }]}>
                      @{result.ownerUsername}
                    </Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          )}

          {/* Selected cross-owner pets — removable chips */}
          {[...selectedPetIds].filter(id => !pets.some(p => p.id === id)).length > 0 && (
            <View style={s.taggedOthersRow}>
              {[...selectedPetIds]
                .filter(id => !pets.some(p => p.id === id))
                .map(id => {
                  // We stored the name via search result — look it up from petSearchData
                  const info = petSearchData?.pets.find(p => p.id === id);
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[s.taggedOtherChip, { backgroundColor: colors.primary + '22', borderColor: colors.primary }]}
                      onPress={() => setSelectedPetIds((prev) => { const n = new Set(prev); n.delete(id); return n; })}
                    >
                      <Text style={[s.taggedOtherName, { color: colors.primary }]}>
                        {info?.name ?? id.slice(0, 8)} ✕
                      </Text>
                    </TouchableOpacity>
                  );
                })}
            </View>
          )}

          {/* Nursery toggle */}
          <Pressable
            style={s.toggleRow}
            onPress={() => setIsNursery((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: isNursery }}
            accessibilityLabel="Nursery post"
          >
            <View style={s.toggleInfo}>
              <Text style={[s.toggleLabel, { color: colors.foreground }]}>Nursery</Text>
              <Text style={[s.toggleSub, { color: colors.mutedForeground }]}>
                Mark as a hatchling or baby post
              </Text>
            </View>
            <View style={[s.track, { backgroundColor: isNursery ? colors.primary : colors.border }]}>
              <View style={[s.thumb, isNursery && s.thumbOn]} />
            </View>
          </Pressable>

        </View>

        {/* Error */}
        {error ? (
          <Text style={[s.error, { color: colors.destructive }]}>{error}</Text>
        ) : null}

      </ScrollView>

      {/* ── Pinned post button ── */}
      <View
        style={[
          s.stickyFooter,
          {
            paddingBottom: Math.max(insets.bottom, 8) + 8,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
            marginBottom: isWeb ? WEB_TAB_BAR_HEIGHT : 0,
          },
        ]}
      >
        <Button
          variant="primary"
          fullWidth
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {isUploading ? (
            <ActivityIndicator color={colors.foreground} />
          ) : (
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.foreground }}>
              Post
            </Text>
          )}
        </Button>
        {!!compressedUri && !hasOwnPetSelected && (
          <Text style={[s.postHint, { color: colors.mutedForeground }]}>
            Choose a pet above to post
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

// ── PetChip ───────────────────────────────────────────────────────────────────

interface PetChipProps {
  pet: Pet;
  selected: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}

function PetChip({ pet, selected, colors, onPress }: PetChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        chipStyles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.secondary,
          borderColor:     selected ? colors.primary : colors.border,
        },
      ]}
    >
      <PetAvatar
        url={pet.thumbnailUrl}
        size={44}
        backgroundColor={selected ? 'rgba(255,255,255,0.25)' : colors.border}
        pawColor={selected ? colors.primaryForeground : colors.mutedForeground}
      />
      <Text style={[
        chipStyles.name,
        { color: selected ? colors.primaryForeground : colors.foreground },
      ]}>
        {pet.name}
      </Text>
    </TouchableOpacity>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 8,
    alignItems: 'center',
    minWidth: 70,
    gap: 6,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    textAlign: 'center',
  },
});

// ── Styles ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStyles(c: ReturnType<typeof useColors>): Record<string, any> {
  return StyleSheet.create({
    fill:     { flex: 1 },
    centered: { alignItems: 'center', justifyContent: 'center' },
    scroll:   { flexGrow: 1, paddingHorizontal: 20 },

    headingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    heading: {
      fontFamily: 'Inter_700Bold',
      fontSize: 26,
      letterSpacing: -0.3,
    },

    emptyTitle: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 18,
      marginBottom: 8,
    },
    emptySub: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      textAlign: 'center',
      marginBottom: 24,
      paddingHorizontal: 32,
    },

    sourceCard: {
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 18,
      marginBottom: 16,
    },
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 18,
    },
    sourceRowText: {
      flex: 1,
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
    },
    sourceDivider: {
      height: StyleSheet.hairlineWidth,
    },

    // Change Photo bottom sheet
    changePhotoOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    changePhotoBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    changePhotoSheet: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 36,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    changePhotoHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 16,
    },
    changePhotoCancel: {
      marginTop: 10,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      paddingVertical: 16,
      alignItems: 'center',
    },
    changePhotoCancelText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
    },

    imagePlaceholder: {
      // height omitted — applied inline via aspectRatio + maxHeight
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 16,
    },
    processingText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      marginTop: 8,
    },
    previewWrapper: {
      // aspectRatio + maxHeight + alignSelf applied inline so they can use the
      // runtime feedAspect value.  Only non-runtime chrome lives here.
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 16,
    },
    preview: {
      // Fill the aspectRatio-driven height of previewWrapper.
      flex: 1,
    },
    previewControls: {
      flexDirection: 'row',
      marginTop: 6,
      marginBottom: 8,
      borderRadius: 10,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
    },
    previewControlBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 9,
      gap: 6,
    },
    previewControlDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
    },
    previewControlText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
    },

    // "Posting as" row — shown instead of pet chips when the user has exactly one pet.
    postingAsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 4,
    },
    postingAsAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    postingAsAvatarFallback: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    postingAsName: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
    },
    postHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      textAlign: 'center',
      marginTop: 6,
    },

    card: {
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 20,
      marginBottom: 16,
      gap: 0,
    },
    label: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      letterSpacing: 0.2,
      marginBottom: 8,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === 'ios' ? 13 : 10,
      fontFamily: 'Inter_400Regular',
      fontSize: 16, // ≥16 prevents iOS Safari auto-zoom on focus
    },
    captionInput: {
      minHeight: 80,
      textAlignVertical: 'top',
      paddingTop: 12,
    },

    petScroll: {
      flexGrow: 0,
    },

    // Collapsed "Tag another pet" accordion (matches profile-edit socials)
    tagToggle: {
      flexDirection:   'row',
      alignItems:      'center',
      justifyContent:  'space-between',
      marginTop:       20,
      marginBottom:    4,
      paddingVertical: 4,
    },
    tagToggleText: {
      fontFamily: 'Inter_400Regular',
      fontSize:   14,
    },
    tagToggleCaret: {
      fontFamily: 'Inter_400Regular',
      fontSize:   14,
    },

    searchResultChip: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginRight: 8,
      marginTop: 6,
    },
    searchResultName: {
      fontSize: 13,
      fontFamily: 'Inter_500Medium',
    },
    searchResultOwner: {
      fontSize: 11,
      marginTop: 1,
    },

    taggedOthersRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 8,
      gap: 6,
    },
    taggedOtherChip: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    taggedOtherName: {
      fontSize: 13,
      fontFamily: 'Inter_500Medium',
    },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 20,
      paddingTop: 16,
    },
    toggleInfo: { flex: 1, marginRight: 16 },
    toggleLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
    },
    toggleSub: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      marginTop: 2,
    },
    track: {
      width: 44,
      height: 26,
      borderRadius: 13,
      justifyContent: 'center',
      paddingHorizontal: 3,
    },
    thumb: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: '#FFFFFF',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.25,
      shadowRadius: 2,
      elevation: 2,
    },
    thumbOn: {
      alignSelf: 'flex-end',
    },

    error: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 12,
    },

    stickyFooter: {
      paddingHorizontal: 20,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
  });
}
