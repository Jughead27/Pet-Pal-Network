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
  Image,
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
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import Button from '@/components/Button';
import {
  useGetMyPets,
  usePresignUpload,
  useCreatePost,
  getGetFeedQueryKey,
} from '@workspace/api-client-react';
import type { Pet } from '@workspace/api-client-react';
import { compressImage } from '@/utils/compressImage';
import FrameRefiner from '@/components/FrameRefiner';
import FocalImage from '@/components/FocalImage';
import { computeAutoFrame } from '@/utils/computeAutoFrame';
import type { CropRect } from '@/utils/computeAutoFrame';
import { signalPostSuccess } from '@/utils/feedScrollSignal';

// ─────────────────────────────────────────────────────────────────────────────

type AddStep = 'idle' | 'compressing' | 'form';

export default function AddScreen() {
  const colors       = useColors();
  const insets       = useSafeAreaInsets();
  const queryClient  = useQueryClient();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const topInset     = Platform.OS === 'web' ? 67 : insets.top;
  const isWeb        = Platform.OS === 'web';

  // Target aspect ratio for auto-frame: the feed hero is full-screen portrait.
  const feedAspect   = screenW / screenH;

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
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [isNursery,     setIsNursery]     = useState(false);
  const [isUploading,   setIsUploading]   = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // Legacy focal point — derived from rect center for backward compat.
  const [cropFocusX,    setCropFocusX]    = useState(0.5);
  const [cropFocusY,    setCropFocusY]    = useState(0.5);

  // New crop rect + mode.
  const [cropRect,      setCropRect]      = useState<CropRect | null>(null);
  const [cropMode,      setCropMode]      = useState<'cover' | 'contain'>('cover');

  // Refiner modal visibility.
  const [refinerOpen,   setRefinerOpen]   = useState(false);

  // Auto-select pet when there is exactly one.
  useEffect(() => {
    if (pets.length === 1) setSelectedPetId(pets[0].id);
  }, [pets]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const { mutateAsync: presignUpload } = usePresignUpload();
  const { mutateAsync: createPost    } = useCreatePost();

  // ── Image pipeline ────────────────────────────────────────────────────────
  // Compress → auto-frame → jump straight to form.
  const processPickedAsset = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    setCompressedUri(null);
    setStep('compressing');
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

    await processPickedAsset(asset);
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

    await processPickedAsset(asset);
  }, [processPickedAsset]);

  // ── Refiner callbacks ─────────────────────────────────────────────────────
  const handleRefineConfirm = useCallback((rect: CropRect, mode: 'cover' | 'contain') => {
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
    setCropFocusX(0.5);
    setCropFocusY(0.5);
    setCropRect(null);
    setCropMode('cover');
    setRefinerOpen(false);
    setError(null);
    if (pets.length !== 1) setSelectedPetId(null);
    router.navigate('/');
  }, [pets.length]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!compressedUri || !selectedPetId || isUploading) return;
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

      await createPost({
        data: {
          petId:      selectedPetId,
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
      setStep('idle');
      if (pets.length !== 1) setSelectedPetId(null);

      router.navigate('/');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setIsUploading(false);
    }
  }, [
    compressedUri, selectedPetId, isUploading, presignUpload, createPost,
    caption, isNursery, cropFocusX, cropFocusY, cropRect, cropMode,
    queryClient, pets.length,
  ]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const canSubmit = !!compressedUri && !!selectedPetId && !isUploading;
  // Derive the selected pet so we can personalise the caption placeholder and
  // show the single-pet "posting as" display without an extra query.
  const selectedPet = pets.find((p) => p.id === selectedPetId) ?? null;
  const captionPlaceholder = selectedPet
    ? `Say something about ${selectedPet.name}… (optional)`
    : 'Say something about your pet… (optional)';
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
        <Feather name="camera-off" size={36} color={colors.mutedForeground} style={{ marginBottom: 16 }} />
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
      {/* ── Frame Refiner modal ─────────────────────────────────────────────── */}
      <Modal
        visible={refinerOpen && !!compressedUri && !!cropRect}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={handleRefineCancel}
      >
        {compressedUri && cropRect ? (
          <FrameRefiner
            uri={compressedUri}
            naturalWidth={naturalSize.current.width  || 1}
            naturalHeight={naturalSize.current.height || 1}
            initialRect={cropRect}
            initialMode={cropMode}
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
              aspectRatio: feedAspect,
              maxHeight: 480,
              alignSelf: 'center',
              width: '100%',
            },
          ]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[s.processingText, { color: colors.mutedForeground }]}>Processing…</Text>
          </View>
        ) : compressedUri ? (
          // WYSIWYG portrait preview — exactly the same crop logic as the feed.
          // aspectRatio gives the portrait shape; maxHeight caps it so it doesn't
          // dominate on landscape viewports; alignSelf='center' centers the box
          // when maxHeight kicks in and Yoga narrows the width to maintain ratio.
          <View style={[
            s.previewWrapper,
            {
              aspectRatio: feedAspect,
              maxHeight: 480,
              alignSelf: 'center',
              width: '100%',
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
            />
            {/* Overlay — "Whole photo" removed; now lives inside the refiner */}
            <View style={s.previewBtnRow}>
              <TouchableOpacity
                style={[s.previewBtn, { backgroundColor: 'rgba(6,11,16,0.6)' }]}
                onPress={() => setRefinerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Adjust framing"
              >
                <Feather name="crop" size={14} color="#F0F4F8" />
                <Text style={s.previewBtnText}>Adjust framing</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.previewBtn, { backgroundColor: 'rgba(6,11,16,0.6)' }]}
                onPress={() => {
                  setCompressedUri(null);
                  setCropRect(null);
                  setError(null);
                  setStep('idle');
                }}
                accessibilityRole="button"
                accessibilityLabel="Change photo"
              >
                <Feather name="refresh-cw" size={14} color="#F0F4F8" />
                <Text style={s.previewBtnText}>Change</Text>
              </TouchableOpacity>
            </View>
          </View>
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
                  <Feather name="camera" size={22} color={colors.foreground} />
                  <Text style={[s.sourceRowText, { color: colors.foreground }]}>Take a photo</Text>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
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
              <Feather name="image" size={22} color={colors.foreground} />
              <Text style={[s.sourceRowText, { color: colors.foreground }]}>Choose from library</Text>
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Form ── */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Pet — FIRST: the pet is the post's identity */}
          <Text style={[s.label, { color: colors.mutedForeground }]}>Pet</Text>
          {pets.length === 1 ? (
            // Single-pet: auto-selected — show a quiet "posting as" line
            <View style={s.postingAsRow}>
              {pets[0].avatarUrl ? (
                <Image source={{ uri: pets[0].avatarUrl }} style={s.postingAsAvatar} />
              ) : (
                <View style={[s.postingAsAvatarFallback, { backgroundColor: colors.secondary }]}>
                  <Text style={[s.postingAsAvatarInitial, { color: colors.mutedForeground }]}>
                    {pets[0].name[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
              )}
              <Text style={[s.postingAsName, { color: colors.foreground }]}>
                {pets[0].name}
              </Text>
            </View>
          ) : (
            // Multi-pet: avatar + name chips
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.petScroll}>
              {pets.map((pet) => (
                <PetChip
                  key={pet.id}
                  pet={pet}
                  selected={pet.id === selectedPetId}
                  colors={colors}
                  onPress={() => setSelectedPetId(pet.id)}
                />
              ))}
            </ScrollView>
          )}

          {/* Caption — AFTER Pet; placeholder personalises once pet is chosen */}
          <Text style={[s.label, { color: colors.mutedForeground, marginTop: 20 }]}>Caption</Text>
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
            maxLength={280}
          />

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
      {pet.avatarUrl ? (
        <Image source={{ uri: pet.avatarUrl }} style={chipStyles.avatar} />
      ) : (
        <View style={[
          chipStyles.avatarFallback,
          { backgroundColor: selected ? 'rgba(255,255,255,0.25)' : colors.border },
        ]}>
          <Text style={[
            chipStyles.avatarInitial,
            { color: selected ? colors.primaryForeground : colors.foreground },
          ]}>
            {pet.name[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      )}
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
  avatarInitial: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
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
    previewBtnRow: {
      position: 'absolute',
      bottom: 10,
      right: 10,
      flexDirection: 'row',
      gap: 8,
    },
    previewBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
    },
    previewBtnText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: '#F0F4F8',
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
    postingAsAvatarInitial: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
    },
    postingAsName: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
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
      fontSize: 15,
    },
    captionInput: {
      minHeight: 80,
      textAlignVertical: 'top',
      paddingTop: 12,
    },

    petScroll: {
      flexGrow: 0,
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
