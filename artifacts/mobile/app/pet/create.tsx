/**
 * Pet Creation Screen
 *
 * Flow:
 *   1. Name (required, free-text)
 *   2. Species picker — horizontal chips from the catalogue
 *   3. Breed picker — searchable list filtered to chosen species,
 *      plus a "Not listed — enter my own" escape hatch for free text.
 *      Free-text breeds are stored in the legacy breed column; they are
 *      candidates for the admin-moderated breed queue.
 *   4. Bio (optional, free-text)
 *   5. Submit — POST /pets with speciesId + breedId (FK path) or
 *      free-text breed (custom path). Server mirrors FK names into the
 *      legacy text columns so all existing display code is unchanged.
 *
 * No react-native-reanimated. Works on iOS, Android, and web.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { CaretRight, X, MagnifyingGlass, PencilSimple } from 'phosphor-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import Button from '@/components/Button';
import { useQuery } from '@tanstack/react-query';
import {
  useCreatePet,
  useGetSpecies,
  getGetSpeciesByIdBreedsQueryOptions,
  getGetMyPetsQueryKey,
} from '@workspace/api-client-react';
import type { BreedItem } from '@workspace/api-client-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const NOT_LISTED_ID = '__not_listed__';

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function CreatePetScreen() {
  const colors      = useColors();
  const insets      = useSafeAreaInsets();
  const queryClient = useQueryClient();

  // ── Form state ────────────────────────────────────────────────────────────
  const [name,              setName]              = useState('');
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<string | null>(null);
  const [selectedBreedId,   setSelectedBreedId]   = useState<string | null>(null);
  const [breedSearch,       setBreedSearch]       = useState('');
  const [breedPickerVisible, setBreedPickerVisible] = useState(false);
  const [customBreed,       setCustomBreed]       = useState('');
  const [useCustomBreed,    setUseCustomBreed]    = useState(false);
  const [bio,               setBio]               = useState('');
  const [error,             setError]             = useState<string | null>(null);

  const bioRef         = useRef<TextInput>(null);
  const customBreedRef = useRef<TextInput>(null);

  // ── Server data ────────────────────────────────────────────────────────────
  const { data: speciesData, isLoading: speciesLoading } = useGetSpecies();
  const speciesList = speciesData?.species ?? [];

  // useQuery with the generated options helper avoids the queryKey type
  // requirement that UseQueryOptions imposes when passed directly to the hook.
  const { data: breedsData, isLoading: breedsLoading } = useQuery({
    ...getGetSpeciesByIdBreedsQueryOptions(selectedSpeciesId ?? ''),
    enabled: !!selectedSpeciesId,
  });
  const allBreeds = breedsData?.breeds ?? [];

  // Filter breed list by the search string (case-insensitive substring match)
  const filteredBreeds = useMemo<BreedItem[]>(() => {
    const q = breedSearch.trim().toLowerCase();
    if (!q) return allBreeds;
    return allBreeds.filter((b) => b.name.toLowerCase().includes(q));
  }, [allBreeds, breedSearch]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const { mutate: createPet, isPending } = useCreatePet();

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSpeciesSelect = useCallback((id: string) => {
    // Switching species clears breed selection
    if (id !== selectedSpeciesId) {
      setSelectedSpeciesId(id);
      setSelectedBreedId(null);
      setBreedSearch('');
      setCustomBreed('');
      setUseCustomBreed(false);
    }
  }, [selectedSpeciesId]);

  const handleBreedSelect = useCallback((breedId: string) => {
    if (breedId === NOT_LISTED_ID) {
      setSelectedBreedId(null);
      setUseCustomBreed(true);
      // Focus the custom breed input after state settles
      setTimeout(() => customBreedRef.current?.focus(), 50);
    } else {
      setSelectedBreedId(breedId);
      setUseCustomBreed(false);
      setCustomBreed('');
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) {
      setError("Pet name is required.");
      return;
    }
    if (!selectedSpeciesId) {
      setError("Please select a species.");
      return;
    }
    setError(null);

    // Resolve what to send for the breed field.
    // FK path: breedId set, no free text needed (server mirrors name).
    // Custom path: free-text stored in legacy breed column, no breedId.
    const breedPayload = useCustomBreed
      ? { breed: customBreed.trim() || undefined, breedId: undefined }
      : selectedBreedId
        ? { breed: undefined, breedId: selectedBreedId }
        : {};

    createPet(
      {
        data: {
          name:      name.trim(),
          speciesId: selectedSpeciesId,
          bio:       bio.trim() || undefined,
          ...breedPayload,
        },
      },
      {
        onSuccess: () => {
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
  }, [name, selectedSpeciesId, selectedBreedId, useCustomBreed, customBreed, bio, createPet, queryClient]);

  const canSubmit = name.trim().length > 0 && !!selectedSpeciesId && !isPending;

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const s        = makeStyles(colors);

  // ── Selected species label (for the breed section header) ─────────────────
  const selectedSpeciesName = speciesList.find((sp) => sp.id === selectedSpeciesId)?.name ?? '';

  const breedLabel =
    ['Fish', 'Bird', 'Reptile', 'Amphibian', 'Invertebrate', 'Small Mammal'].includes(selectedSpeciesName)
      ? 'Type / Kind'
      : 'Breed';

  // Resolved display name for the selected breed FK — drives the summary row
  const selectedBreedName = useMemo(
    () => allBreeds.find((b) => b.id === selectedBreedId)?.name ?? null,
    [allBreeds, selectedBreedId],
  );

  // ── Render ────────────────────────────────────────────────────────────────
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
          { paddingTop: topInset + 56, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.title}>New pet</Text>
        <Text style={s.subtitle}>Tell us about them</Text>

        {/* ── Name ── */}
        <View style={s.card}>
          <Text style={s.label}>Name *</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Finn"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            returnKeyType="next"
            blurOnSubmit={false}
            autoFocus
          />
        </View>

        {/* ── Species ── */}
        <View style={s.card}>
          <Text style={s.label}>Species *</Text>
          {speciesLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.chipScroll}
              contentContainerStyle={s.chipRow}
              keyboardShouldPersistTaps="handled"
            >
              {speciesList.map((sp) => {
                const active = sp.id === selectedSpeciesId;
                return (
                  <TouchableOpacity
                    key={sp.id}
                    onPress={() => handleSpeciesSelect(sp.id)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[
                      s.chip,
                      {
                        backgroundColor: active ? colors.primary     : colors.secondary,
                        borderColor:     active ? colors.primary     : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        s.chipText,
                        { color: active ? colors.primaryForeground : colors.foreground },
                      ]}
                    >
                      {sp.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* ── Breed — only shown after species is chosen ── */}
        {selectedSpeciesId && (
          <View style={s.card}>
            <Text style={s.label}>
              {breedLabel}
              <Text style={[s.label, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}> (optional)</Text>
            </Text>

            {breedsLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
            ) : allBreeds.length > 0 ? (
              <>
                {/* Summary row — tapping opens the full-screen picker modal */}
                <TouchableOpacity
                  onPress={() => { setBreedSearch(''); setBreedPickerVisible(true); }}
                  style={s.breedSummaryRow}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose ${breedLabel.toLowerCase()}`}
                >
                  <Text
                    style={[
                      s.breedSummaryValue,
                      { color: (useCustomBreed || selectedBreedId) ? colors.foreground : colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {useCustomBreed ? 'Custom (see below)' : selectedBreedName ?? 'Not selected'}
                  </Text>
                  <CaretRight size={16} color={colors.mutedForeground} weight="regular" />
                </TouchableOpacity>

                {/* Custom breed input — only shown when "Not listed" is active */}
                {useCustomBreed && (
                  <View style={s.customBreedWrapper}>
                    <TextInput
                      ref={customBreedRef}
                      style={s.input}
                      value={customBreed}
                      onChangeText={setCustomBreed}
                      placeholder="Enter breed name…"
                      placeholderTextColor={colors.mutedForeground}
                      selectionColor={colors.primary}
                      returnKeyType="next"
                      onSubmitEditing={() => bioRef.current?.focus()}
                      blurOnSubmit={false}
                    />
                    <Text style={[s.customBreedHint, { color: colors.mutedForeground }]}>
                      Suggested breeds are reviewed before being added to the list.
                    </Text>
                  </View>
                )}
              </>
            ) : (
              /* Species with no breeds (e.g. Other) — free-text only */
              <TextInput
                ref={customBreedRef}
                style={s.input}
                value={customBreed}
                onChangeText={setCustomBreed}
                placeholder="Optional"
                placeholderTextColor={colors.mutedForeground}
                selectionColor={colors.primary}
                returnKeyType="next"
                onSubmitEditing={() => bioRef.current?.focus()}
                blurOnSubmit={false}
              />
            )}
          </View>
        )}

        {/* ── Bio ── */}
        <View style={s.card}>
          <Text style={s.label}>Bio</Text>
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
        </View>

        {/* ── Error + submit ── */}
        {error ? <Text style={[s.error, { color: colors.destructive }]}>{error}</Text> : null}

        <Button
          variant="primary"
          fullWidth
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={{ marginTop: 4 }}
        >
          {isPending ? (
            <ActivityIndicator color={colors.foreground} />
          ) : (
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.foreground }}>
              Create pet
            </Text>
          )}
        </Button>
        <Button
          variant="quiet"
          label="Cancel"
          onPress={() => router.back()}
        />
      </ScrollView>

      {/* ── Breed picker modal ── */}
      <Modal
        visible={breedPickerVisible}
        animationType="slide"
        onRequestClose={() => setBreedPickerVisible(false)}
      >
        <View style={[s.breedModal, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={[s.breedModalHeader, { borderBottomColor: colors.border, paddingTop: topInset + 16 }]}>
            <Text style={[s.breedModalTitle, { color: colors.foreground }]}>
              {breedLabel}
            </Text>
            <TouchableOpacity
              onPress={() => setBreedPickerVisible(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={22} color={colors.foreground} weight="regular" />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={[s.breedModalSearch, { borderBottomColor: colors.border }]}>
            <View style={[s.searchBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <MagnifyingGlass size={15} color={colors.mutedForeground} weight="regular" style={s.searchIcon} />
              <TextInput
                style={[s.searchInput, { color: colors.foreground }]}
                value={breedSearch}
                onChangeText={setBreedSearch}
                placeholder="Search breeds…"
                placeholderTextColor={colors.mutedForeground}
                selectionColor={colors.primary}
                returnKeyType="search"
                clearButtonMode="while-editing"
                autoFocus={Platform.OS !== 'web'}
              />
              {breedSearch.length > 0 && Platform.OS !== 'ios' && (
                <TouchableOpacity
                  onPress={() => setBreedSearch('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <X size={14} color={colors.mutedForeground} weight="regular" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Breed list */}
          <FlatList
            data={filteredBreeds}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const active = item.id === selectedBreedId && !useCustomBreed;
              return (
                <TouchableOpacity
                  onPress={() => {
                    handleBreedSelect(item.id);
                    setBreedPickerVisible(false);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[
                    s.breedRow,
                    { borderBottomColor: colors.border },
                    active && { backgroundColor: `${colors.primary}18` },
                  ]}
                >
                  <Text style={[s.breedRowText, { color: active ? colors.primary : colors.foreground }]}>
                    {item.name}
                  </Text>
                  {active && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                </TouchableOpacity>
              );
            }}
            ListFooterComponent={() => (
              <TouchableOpacity
                onPress={() => {
                  handleBreedSelect(NOT_LISTED_ID);
                  setBreedPickerVisible(false);
                  setTimeout(() => customBreedRef.current?.focus(), 350);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                style={[s.breedRow, { borderBottomWidth: 0, marginBottom: insets.bottom + 16 }]}
              >
                <Text style={[s.breedRowText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  Not listed — enter my own
                </Text>
                <PencilSimple size={14} color={colors.mutedForeground} weight="regular" />
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStyles(c: ReturnType<typeof useColors>): Record<string, any> {
  return StyleSheet.create({
    flex:   { flex: 1 },
    scroll: { flexGrow: 1, paddingHorizontal: 20 },

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
      marginBottom: 24,
    },

    card: {
      backgroundColor: c.card,
      borderRadius: c.radius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 20,
      marginBottom: 14,
    },
    label: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: c.mutedForeground,
      marginBottom: 10,
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

    // Species chips
    chipScroll:  { marginTop: 2 },
    chipRow:     { gap: 8, paddingRight: 4 },
    chip: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    chipText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
    },

    // Breed search (used inside the picker modal)
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: c.radius - 4,
      paddingHorizontal: 10,
      marginBottom: 0,
    },
    searchIcon:  { marginRight: 6 },
    searchInput: {
      flex: 1,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    },

    // Breed summary row (collapsed picker on the create screen)
    breedSummaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: c.radius - 4,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    breedSummaryValue: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      flex: 1,
      marginRight: 8,
    },

    // Breed picker modal
    breedModal: {
      flex: 1,
    },
    breedModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingBottom: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    breedModalTitle: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 20,
      color: c.foreground,
    },
    breedModalSearch: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },

    // Breed rows (used in picker modal)
    breedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    breedRowText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      flex: 1,
    },

    // Custom breed
    customBreedWrapper: { marginTop: 10 },
    customBreedHint: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      marginTop: 6,
      lineHeight: 16,
    },

    // Submit
    error: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 12,
    },
  });
}
