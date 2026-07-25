/**
 * Pet Creation Screen
 *
 * Simple form: name (required), species (required), breed (optional), bio (optional).
 * Uses the same design language as sign-up.tsx (Inter, card layout, existing input styling).
 * On success: invalidates the getMyPets query cache, navigates back to Profile.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import {
  useCreatePet,
  getGetMyPetsQueryKey,
} from '@workspace/api-client-react';

export default function CreatePetScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [name,    setName]    = useState('');
  const [species, setSpecies] = useState('');
  const [breed,   setBreed]   = useState('');
  const [bio,     setBio]     = useState('');
  const [error,   setError]   = useState<string | null>(null);

  const speciesRef = useRef<TextInput>(null);
  const breedRef   = useRef<TextInput>(null);
  const bioRef     = useRef<TextInput>(null);

  const { mutate: createPet, isPending } = useCreatePet();

  const canSubmit = name.trim().length > 0 && species.trim().length > 0 && !isPending;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    setError(null);

    createPet(
      {
        data: {
          name:    name.trim(),
          species: species.trim(),
          breed:   breed.trim() || undefined,
          bio:     bio.trim()   || undefined,
        },
      },
      {
        onSuccess: () => {
          // Invalidate so Profile re-fetches the updated pet list.
          queryClient.invalidateQueries({ queryKey: getGetMyPetsQueryKey() });
          router.back();
        },
        onError: (err) => {
          const msg =
            (err as { message?: string }).message ??
            'Something went wrong. Please try again.';
          setError(msg);
        },
      },
    );
  }, [canSubmit, createPet, name, species, breed, bio, queryClient]);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const s = makeStyles(colors);

  return (
    <KeyboardAvoidingView
      style={[s.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={[s.backBtn, { top: topInset + 8 }]}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={colors.foreground} />
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingTop: topInset + 56, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.title}>New pet</Text>
        <Text style={s.subtitle}>Tell us about them</Text>

        <View style={s.card}>
          {/* Name */}
          <Text style={s.label}>Name *</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Finn"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            returnKeyType="next"
            onSubmitEditing={() => speciesRef.current?.focus()}
            blurOnSubmit={false}
            autoFocus
          />

          {/* Species */}
          <Text style={[s.label, { marginTop: 16 }]}>Species *</Text>
          <TextInput
            ref={speciesRef}
            style={s.input}
            value={species}
            onChangeText={setSpecies}
            placeholder="e.g. Dog, Cat, Rabbit…"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            returnKeyType="next"
            onSubmitEditing={() => breedRef.current?.focus()}
            blurOnSubmit={false}
          />

          {/* Breed (optional) */}
          <Text style={[s.label, { marginTop: 16 }]}>Breed</Text>
          <TextInput
            ref={breedRef}
            style={s.input}
            value={breed}
            onChangeText={setBreed}
            placeholder="Optional"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            returnKeyType="next"
            onSubmitEditing={() => bioRef.current?.focus()}
            blurOnSubmit={false}
          />

          {/* Bio (optional) */}
          <Text style={[s.label, { marginTop: 16 }]}>Bio</Text>
          <TextInput
            ref={bioRef}
            style={[s.input, s.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="A little about them… (optional)"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            multiline
            returnKeyType="done"
            blurOnSubmit
          />

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [s.primaryBtn, !canSubmit && s.disabled, pressed && s.pressed]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={s.primaryBtnText}>Create pet</Text>
            )}
          </Pressable>
        </View>

        <Text style={s.hint}>
          * required — species and breed are free-text for now
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStyles(c: ReturnType<typeof useColors>): Record<string, any> {
  return StyleSheet.create({
    flex: { flex: 1 },
    scroll: { flexGrow: 1, paddingHorizontal: 24 },

    backBtn: {
      position: 'absolute',
      left: 14,
      zIndex: 10,
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },

    title: {
      fontFamily: 'Inter_700Bold',
      fontSize: 28,
      color: c.foreground,
      letterSpacing: -0.5,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: c.mutedForeground,
      marginTop: 4,
      marginBottom: 32,
    },

    card: {
      backgroundColor: c.card,
      borderRadius: c.radius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 24,
    },

    label: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: c.mutedForeground,
      marginBottom: 8,
      letterSpacing: 0.2,
    },
    input: {
      backgroundColor: c.secondary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: c.radius - 4,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === 'ios' ? 13 : 10,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: c.foreground,
    },
    bioInput: {
      minHeight: 80,
      textAlignVertical: 'top',
      paddingTop: 12,
    },

    error: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: c.destructive,
      marginTop: 12,
    },

    primaryBtn: {
      backgroundColor: c.primary,
      borderRadius: c.radius - 4,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 24,
    },
    primaryBtnText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
      color: c.primaryForeground,
    },
    disabled: { opacity: 0.45 },
    pressed:  { opacity: 0.75 },

    hint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: c.mutedForeground,
      textAlign: 'center',
      marginTop: 16,
    },
  });
}
