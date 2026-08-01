/**
 * Add tab — image upload + post creation.
 *
 * Flow:
 *   1. If the user owns no pets → prompt linking to pet creation.
 *   2. Pick a photo from the camera roll (expo-image-picker).
 *   3. Compress to max 2048 px longest edge as JPEG (compressImage util).
 *   4. WYSIWYG framing step — CropFramer lets the poster choose what will
 *      be visible in the feed cover-crop. Stores focusX / focusY (0–1).
 *   5. Form: caption + pet selector + nursery toggle.
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
import CropFramer from '@/components/CropFramer';
import { signalPostSuccess } from '@/utils/feedScrollSignal';

// ─────────────────────────────────────────────────────────────────────────────

type AddStep = 'idle' | 'compressing' | 'framing' | 'form';

export default function AddScreen() {
  const colors       = useColors();
  const insets       = useSafeAreaInsets();
  const queryClient  = useQueryClient();
  const topInset     = Platform.OS === 'web' ? 67 : insets.top;

  // ── Server state ──────────────────────────────────────────────────────────
  const { data: myPetsData, isLoading: petsLoading } = useGetMyPets();
  const pets = myPetsData?.pets ?? [];

  // ── Local state ───────────────────────────────────────────────────────────
  const [step,          setStep]          = useState<AddStep>('idle');
  const [compressedUri, setCompressedUri] = useState<string | null>(null);
  // Natural pixel dimensions of the compressed image (needed by CropFramer).
  const naturalSize = useRef({ width: 0, height: 0 });
  const [caption,       setCaption]       = useState('');
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [isNursery,     setIsNursery]     = useState(false);
  const [isUploading,   setIsUploading]   = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  // Focal point chosen in the framing step (0–1, default center).
  const [cropFocusX,    setCropFocusX]    = useState(0.5);
  const [cropFocusY,    setCropFocusY]    = useState(0.5);

  // Auto-select pet when there is exactly one.
  useEffect(() => {
    if (pets.length === 1) setSelectedPetId(pets[0].id);
  }, [pets]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const { mutateAsync: presignUpload } = usePresignUpload();
  const { mutateAsync: createPost    } = useCreatePost();

  // ── Image pipeline (shared by both sources) ───────────────────────────────
  // Compress → store natural size → advance to framing step.
  // Called with the raw asset from either launchImageLibraryAsync or
  // launchCameraAsync — the rest of the flow is identical.
  const processPickedAsset = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    setCompressedUri(null);
    setStep('compressing');
    try {
      const compressed = await compressImage(asset.uri, asset.width, asset.height);
      setCompressedUri(compressed.uri);
      // Store compressed pixel dimensions (or original when not returned).
      naturalSize.current = {
        width:  (compressed as { width?: number }).width  ?? asset.width,
        height: (compressed as { height?: number }).height ?? asset.height,
      };
      // Reset focal point to center for each new image.
      setCropFocusX(0.5);
      setCropFocusY(0.5);
      setStep('framing');
    } catch {
      setError('Failed to process image. Please try another photo.');
      setStep('idle');
    }
  }, []);

  // ── Image picking — library ────────────────────────────────────────────────
  const pickImage = useCallback(async () => {
    setError(null);

    // On native, request library permission.
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
  // Web camera capture is unreliable across browsers. On web we only offer the
  // library picker (the file input may surface the camera natively for free).
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

    // Camera produces JPEG on iOS; guard anyway for safety.
    const asset = result.assets[0];
    const mime  = asset.mimeType ?? '';
    if (mime && !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      setError('Only JPEG, PNG, and WebP images are supported.');
      return;
    }

    await processPickedAsset(asset);
  }, [processPickedAsset]);

  // ── Framing callbacks ─────────────────────────────────────────────────────
  const handleFrameConfirm = useCallback((fx: number, fy: number) => {
    setCropFocusX(fx);
    setCropFocusY(fy);
    setStep('form');
  }, []);

  const handleFrameBack = useCallback(() => {
    // Return to the form with the picked image retained.
    // Only an explicit "Change photo" button discards the selection.
    setStep('form');
  }, []);

  // ── Compose cancel — discards draft and returns to Home ──────────────────
  // The Add tab has no back stack, so we reset state AND navigate to '/'.
  const handleCancel = useCallback(() => {
    setStep('idle');
    setCompressedUri(null);
    setCaption('');
    setIsNursery(false);
    setCropFocusX(0.5);
    setCropFocusY(0.5);
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
      // 1. Materialise as a blob to get the exact byte count.
      const imageResponse = await fetch(compressedUri);
      const blob          = await imageResponse.blob();

      if (blob.size > 10 * 1024 * 1024) {
        setError('This photo is too large (max 10 MB). Please choose a smaller image.');
        setIsUploading(false);
        return;
      }

      // 2. Obtain presigned PUT URL.
      const { uploadUrl, mediaKey } = await presignUpload({
        data: { contentType: 'image/jpeg', sizeBytes: blob.size },
      });

      // 3. Upload directly to R2.
      const putRes = await fetch(uploadUrl, {
        method:  'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body:    blob,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      // 4. Create the post record, including the focal point.
      await createPost({
        data: {
          petId:      selectedPetId,
          mediaKey,
          caption:    caption.trim() || undefined,
          isNursery,
          cropFocusX,
          cropFocusY,
        },
      });

      // 5. Refresh feed and navigate home, scrolling the pager to the new post.
      // Signal BEFORE invalidation so the timestamp always precedes the refetch.
      signalPostSuccess();
      queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });

      // Reset form.
      setCompressedUri(null);
      setCaption('');
      setIsNursery(false);
      setCropFocusX(0.5);
      setCropFocusY(0.5);
      setStep('idle');
      if (pets.length !== 1) setSelectedPetId(null);

      router.navigate('/');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      setError(msg);
    } finally {
      setIsUploading(false);
    }
  }, [compressedUri, selectedPetId, isUploading, presignUpload, createPost, caption, isNursery, cropFocusX, cropFocusY, queryClient, pets.length]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const canSubmit = !!compressedUri && !!selectedPetId && !isUploading;
  const s = makeStyles(colors);

  // ── Render ────────────────────────────────────────────────────────────────

  if (petsLoading) {
    return (
      <View style={[s.fill, s.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // No pets — prompt user to create one first.
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
      {/* ── Framing modal — sits above the tab bar, no tab-bar interaction ── */}
      <Modal
        visible={step === 'framing' && !!compressedUri}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={handleFrameBack}
      >
        {compressedUri ? (
          <CropFramer
            uri={compressedUri}
            naturalWidth={naturalSize.current.width  || 1}
            naturalHeight={naturalSize.current.height || 1}
            onConfirm={handleFrameConfirm}
            onBack={handleFrameBack}
          />
        ) : null}
      </Modal>
      <ScrollView
        style={s.fill}
        contentContainerStyle={[
          s.scroll,
          { paddingTop: topInset + 16, paddingBottom: 24 },
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
          <View style={[s.imagePlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[s.processingText, { color: colors.mutedForeground }]}>Processing…</Text>
          </View>
        ) : compressedUri ? (
          // Form step: show the framed preview (cover, focal point applied).
          <View style={s.previewWrapper}>
            <Image
              source={{ uri: compressedUri }}
              style={s.preview}
              resizeMode="cover"
            />
            {/* Re-frame button */}
            <View style={s.previewBtnRow}>
              <TouchableOpacity
                style={[s.previewBtn, { backgroundColor: 'rgba(6,11,16,0.6)' }]}
                onPress={() => setStep('framing')}
                accessibilityRole="button"
                accessibilityLabel="Adjust framing"
              >
                <Feather name="crop" size={14} color="#F0F4F8" />
                <Text style={s.previewBtnText}>Reframe</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.previewBtn, { backgroundColor: 'rgba(6,11,16,0.6)' }]}
                onPress={() => {
                  // Return to source selection — lets the user pick from
                  // library or re-shoot rather than hardcoding library.
                  setCompressedUri(null);
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
          // ── Source selection ────────────────────────────────────────────
          // Native: camera capture + library. Web: library only (browser's
          // file input may surface the camera natively for free; no custom
          // camera UI needed or built here).
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

          {/* Caption */}
          <Text style={[s.label, { color: colors.mutedForeground }]}>Caption</Text>
          <TextInput
            style={[s.input, s.captionInput, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }]}
            value={caption}
            onChangeText={setCaption}
            placeholder="Say something about your pet… (optional)"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            multiline
            returnKeyType="done"
            blurOnSubmit
            maxLength={280}
          />

          {/* Pet selector — hidden when there is only one pet */}
          {pets.length > 1 && (
            <>
              <Text style={[s.label, { color: colors.mutedForeground, marginTop: 16 }]}>
                Pet
              </Text>
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
            </>
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

      {/* ── Pinned post button — always visible above tab bar ── */}
      <View
        style={[
          s.stickyFooter,
          {
            paddingBottom: Math.max(insets.bottom, 8) + 8,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
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
      <Text style={[
        chipStyles.name,
        { color: selected ? colors.primaryForeground : colors.foreground },
      ]}>
        {pet.name}
      </Text>
      <Text style={[
        chipStyles.species,
        { color: selected ? colors.primaryForeground : colors.mutedForeground },
      ]}>
        {pet.species}
      </Text>
    </TouchableOpacity>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
    alignItems: 'center',
    minWidth: 80,
  },
  name: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  species: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
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

    // Empty / no-pets state
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

    // Source selection card (camera vs library)
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

    // Image area
    imagePlaceholder: {
      height: 220,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 16,
    },
    pickPhotoText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
    },
    pickPhotoHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
    },
    processingText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      marginTop: 8,
    },
    previewWrapper: {
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 16,
      position: 'relative',
    },
    preview: {
      width: '100%',
      height: 260,
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

    // Form card
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

    // Toggle
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 20,
      paddingTop: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
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

    // Error
    error: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 12,
    },

    // Pinned footer that holds the Post button
    stickyFooter: {
      paddingHorizontal: 20,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
    },

  });
}
