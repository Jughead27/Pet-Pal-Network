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
import {
  useGetMyPets,
  usePresignUpload,
  useCreatePost,
  getGetFeedQueryKey,
} from '@workspace/api-client-react';
import type { Pet } from '@workspace/api-client-react';
import { compressImage } from '@/utils/compressImage';
import CropFramer from '@/components/CropFramer';

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

  // ── Image picking ─────────────────────────────────────────────────────────
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

    // Guard: only JPEG, PNG, WebP
    const mime = asset.mimeType ?? '';
    if (mime && !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      setError('Only JPEG, PNG, and WebP images are supported.');
      return;
    }

    setCompressedUri(null);
    setStep('compressing');
    try {
      const compressed = await compressImage(asset.uri, asset.width, asset.height);
      setCompressedUri(compressed.uri);
      // Store the compressed pixel dimensions (or original if not returned).
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

  // ── Framing callbacks ─────────────────────────────────────────────────────
  const handleFrameConfirm = useCallback((fx: number, fy: number) => {
    setCropFocusX(fx);
    setCropFocusY(fy);
    setStep('form');
  }, []);

  const handleFrameBack = useCallback(() => {
    // Go back to idle so the user can pick a different image.
    setCompressedUri(null);
    setStep('idle');
  }, []);

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

      // 5. Refresh feed and navigate home.
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

  // ── Framing step — full-screen, outside scroll ─────────────────────────
  if (step === 'framing' && compressedUri) {
    return (
      <CropFramer
        uri={compressedUri}
        naturalWidth={naturalSize.current.width  || 1}
        naturalHeight={naturalSize.current.height || 1}
        onConfirm={handleFrameConfirm}
        onBack={handleFrameBack}
      />
    );
  }

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
        <Pressable
          style={({ pressed }) => [s.primaryBtn, { backgroundColor: colors.primary }, pressed && s.pressed]}
          onPress={() => router.push('/pet/create')}
        >
          <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>Create a pet</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[s.fill, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={s.fill}
        contentContainerStyle={[
          s.scroll,
          { paddingTop: topInset + 16, paddingBottom: insets.bottom + 100 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[s.heading, { color: colors.foreground }]}>New Post</Text>

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
                onPress={pickImage}
                accessibilityRole="button"
                accessibilityLabel="Change photo"
              >
                <Feather name="refresh-cw" size={14} color="#F0F4F8" />
                <Text style={s.previewBtnText}>Change</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              s.imagePlaceholder,
              { backgroundColor: colors.card, borderColor: colors.border },
              pressed && s.pressed,
            ]}
            onPress={pickImage}
            accessibilityRole="button"
            accessibilityLabel="Pick a photo"
          >
            <Feather name="image" size={32} color={colors.mutedForeground} />
            <Text style={[s.pickPhotoText, { color: colors.mutedForeground }]}>
              Tap to pick a photo
            </Text>
            <Text style={[s.pickPhotoHint, { color: colors.mutedForeground }]}>
              JPEG · PNG · WebP · max 10 MB
            </Text>
          </Pressable>
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

        {/* Submit */}
        <Pressable
          style={({ pressed }) => [
            s.primaryBtn,
            { backgroundColor: colors.primary, marginTop: 4 },
            !canSubmit && s.disabled,
            pressed && canSubmit && s.pressed,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {isUploading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>Post</Text>
          )}
        </Pressable>
      </ScrollView>
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

    heading: {
      fontFamily: 'Inter_700Bold',
      fontSize: 26,
      letterSpacing: -0.3,
      marginBottom: 20,
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

    // Buttons
    primaryBtn: {
      borderRadius: 12,
      paddingVertical: 15,
      alignItems: 'center',
    },
    primaryBtnText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 16,
    },
    disabled: { opacity: 0.45 },
    pressed:  { opacity: 0.75 },
  });
}
