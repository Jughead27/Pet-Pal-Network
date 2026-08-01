/**
 * Edit Pet Profile Screen
 *
 * Reuses the same species chips, breed picker (searchable list + "Not listed"
 * free-text escape hatch), name input, and bio input from the creation flow.
 * All behaviour — species selection clears breed, FK resolution, free-text
 * breed path — is identical to create.tsx.
 *
 * Route: /pet/edit?id=<petId>
 *
 * On save: PATCH /pets/:id with only the fields the user can change (name,
 * species, breed, bio). Client invalidates the pet profile and My Pets queries
 * so all surfaces (profile header, feed overlays, My Pack rows) pick up the
 * new values after the next refetch.
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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import Button from '@/components/Button';
import {
  useGetPet,
  usePatchPet,
  useDeletePet,
  useGetSpecies,
  getGetSpeciesByIdBreedsQueryOptions,
  getGetPetQueryKey,
  getGetMyPetsQueryKey,
  getGetMyFollowsQueryKey,
  getGetFeedQueryKey,
} from '@workspace/api-client-react';
import type { BreedItem, PetProfile } from '@workspace/api-client-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const NOT_LISTED_ID = '__not_listed__';

// ─── Outer screen — fetches pet data then delegates to the form ───────────────

export default function EditPetScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const { id }  = useLocalSearchParams<{ id: string }>();
  const petId   = Array.isArray(id) ? id[0] : (id ?? '');

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const { data: pet, isLoading, isError } = useGetPet(petId);

  // ── Loading / error ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[s.fill, s.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || !pet) {
    return (
      <View style={[s.fill, s.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
          Could not load pet profile.
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.primary, fontSize: 14 }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <EditPetForm
      pet={pet}
      petId={petId}
      topInset={topInset}
      colors={colors}
      insets={insets}
    />
  );
}

// ─── Inner form — receives pet as a required prop so useState initialises once ─

interface EditPetFormProps {
  pet:      PetProfile;
  petId:    string;
  topInset: number;
  colors:   ReturnType<typeof useColors>;
  insets:   ReturnType<typeof useSafeAreaInsets>;
}

function EditPetForm({ pet, petId, topInset, colors, insets }: EditPetFormProps) {
  const queryClient = useQueryClient();

  // ── Form state — prefilled from current pet values ─────────────────────────
  const [name, setName] = useState(pet.name);

  // Determine initial breed state from what the pet currently has.
  // FK path: breedId is set → select that chip.
  // Free-text path: breed is set but no breedId → show custom input.
  const initialUseCustomBreed = !pet.breedId && !!pet.breed;
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<string | null>(pet.speciesId ?? null);
  const [selectedBreedId,   setSelectedBreedId]   = useState<string | null>(pet.breedId ?? null);
  const [breedSearch,       setBreedSearch]       = useState('');
  const [customBreed,       setCustomBreed]       = useState(initialUseCustomBreed ? (pet.breed ?? '') : '');
  const [useCustomBreed,    setUseCustomBreed]    = useState(initialUseCustomBreed);
  const [bio,               setBio]               = useState(pet.bio ?? '');
  const [error,             setError]             = useState<string | null>(null);

  const bioRef         = useRef<TextInput>(null);
  const customBreedRef = useRef<TextInput>(null);

  // ── Server data ────────────────────────────────────────────────────────────
  const { data: speciesData, isLoading: speciesLoading } = useGetSpecies();
  const speciesList = speciesData?.species ?? [];

  const { data: breedsData, isLoading: breedsLoading } = useQuery({
    ...getGetSpeciesByIdBreedsQueryOptions(selectedSpeciesId ?? ''),
    enabled: !!selectedSpeciesId,
  });
  const allBreeds = breedsData?.breeds ?? [];

  const filteredBreeds = useMemo<BreedItem[]>(() => {
    const q = breedSearch.trim().toLowerCase();
    if (!q) return allBreeds;
    return allBreeds.filter((b) => b.name.toLowerCase().includes(q));
  }, [allBreeds, breedSearch]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const { mutate: patchPet, isPending } = usePatchPet();
  const { mutate: deletePet, isPending: isDeleting } = useDeletePet();

  // ── Delete state ───────────────────────────────────────────────────────────
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);

  const totalPosts = (pet.posts?.length ?? 0) + (pet.archivedPosts?.length ?? 0);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSpeciesSelect = useCallback((id: string) => {
    if (id !== selectedSpeciesId) {
      setSelectedSpeciesId(id);
      // Changing species always clears breed — same rule as create.tsx
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
      setTimeout(() => customBreedRef.current?.focus(), 50);
    } else {
      setSelectedBreedId(breedId);
      setUseCustomBreed(false);
      setCustomBreed('');
    }
  }, []);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      setError('Pet name is required.');
      return;
    }
    if (!selectedSpeciesId) {
      setError('Please select a species.');
      return;
    }
    setError(null);

    // Breed payload — mirrors the create.tsx logic exactly.
    // FK path: breedId is set → send it (server resolves authoritative name).
    // Custom path: free-text → send breed string, breedId null.
    // No breed: neither selected → send breedId: null to clear any existing value.
    const breedPayload = useCustomBreed
      ? { breed: customBreed.trim() || undefined, breedId: null as null }
      : selectedBreedId
        ? { breedId: selectedBreedId, breed: undefined }
        : { breedId: null as null, breed: undefined };

    patchPet(
      {
        id:   petId,
        data: {
          name:      name.trim(),
          speciesId: selectedSpeciesId,
          bio:       bio.trim() || null,
          ...breedPayload,
        },
      },
      {
        onSuccess: () => {
          // Invalidate all affected queries so every surface updates on next render.
          queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(petId) });
          queryClient.invalidateQueries({ queryKey: getGetMyPetsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyFollowsQueryKey() });
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
  }, [
    name, selectedSpeciesId, selectedBreedId, useCustomBreed,
    customBreed, bio, petId, patchPet, queryClient,
  ]);

  const canSave = name.trim().length > 0 && !!selectedSpeciesId && !isPending;

  const handleConfirmDelete = useCallback(() => {
    deletePet(
      { id: petId },
      {
        onSuccess: () => {
          setDeleteConfirmVisible(false);
          queryClient.invalidateQueries({ queryKey: getGetMyPetsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyFollowsQueryKey() });
          router.navigate('/(tabs)/profile');
        },
        onError: (err) => {
          setDeleteConfirmVisible(false);
          setError(
            (err as { message?: string }).message ?? 'Failed to delete. Please try again.',
          );
        },
      },
    );
  }, [petId, deletePet, queryClient]);

  // Selected species label — used as the breed section header
  const selectedSpeciesName = speciesList.find((sp) => sp.id === selectedSpeciesId)?.name ?? '';

  const breedLabel =
    ['Fish', 'Bird', 'Reptile', 'Amphibian', 'Invertebrate', 'Small Mammal'].includes(selectedSpeciesName)
      ? 'Type / Kind'
      : 'Breed';

  return (
    <KeyboardAvoidingView
      style={[s.fill, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={[s.backBtn, { top: topInset + 8 }]}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        disabled={isPending}
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
        <Text style={[s.title, { color: colors.foreground }]}>Edit profile</Text>
        <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
          Update {pet.name}'s details
        </Text>

        {/* ── Name ── */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.label, { color: colors.mutedForeground }]}>Name *</Text>
          <TextInput
            style={[s.input, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Finn"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            returnKeyType="next"
            blurOnSubmit={false}
            maxLength={100}
          />
        </View>

        {/* ── Species ── */}
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.label, { color: colors.mutedForeground }]}>Species *</Text>
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
                        backgroundColor: active ? colors.primary    : colors.secondary,
                        borderColor:     active ? colors.primary    : colors.border,
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
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.label, { color: colors.mutedForeground }]}>
              {breedLabel}
              <Text style={[s.label, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {' '}(optional)
              </Text>
            </Text>

            {breedsLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
            ) : allBreeds.length > 0 ? (
              <>
                {/* Search box */}
                <View style={[s.searchBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  <Feather name="search" size={15} color={colors.mutedForeground} style={s.searchIcon} />
                  <TextInput
                    style={[s.searchInput, { color: colors.foreground }]}
                    value={breedSearch}
                    onChangeText={setBreedSearch}
                    placeholder="Search breeds…"
                    placeholderTextColor={colors.mutedForeground}
                    selectionColor={colors.primary}
                    returnKeyType="search"
                    clearButtonMode="while-editing"
                  />
                  {breedSearch.length > 0 && Platform.OS !== 'ios' && (
                    <TouchableOpacity
                      onPress={() => setBreedSearch('')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Feather name="x" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Breed list — fixed-height scrollable */}
                <View style={[s.breedListWrapper, { borderColor: colors.border }]}>
                  <FlatList
                    data={filteredBreeds}
                    keyExtractor={(item) => item.id}
                    scrollEnabled
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    style={s.breedList}
                    renderItem={({ item }) => {
                      const active = item.id === selectedBreedId && !useCustomBreed;
                      return (
                        <TouchableOpacity
                          onPress={() => handleBreedSelect(item.id)}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          style={[
                            s.breedRow,
                            { borderBottomColor: colors.border },
                            active && { backgroundColor: `${colors.primary}18` },
                          ]}
                        >
                          <Text
                            style={[
                              s.breedRowText,
                              { color: active ? colors.primary : colors.foreground },
                            ]}
                          >
                            {item.name}
                          </Text>
                          {active && (
                            <Ionicons name="checkmark" size={16} color={colors.primary} />
                          )}
                        </TouchableOpacity>
                      );
                    }}
                    ListFooterComponent={() => (
                      <TouchableOpacity
                        onPress={() => handleBreedSelect(NOT_LISTED_ID)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        style={[s.breedRow, { borderBottomWidth: 0 }]}
                      >
                        <Text
                          style={[
                            s.breedRowText,
                            { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
                          ]}
                        >
                          Not listed — enter my own
                        </Text>
                        <Feather name="edit-2" size={14} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    )}
                  />
                </View>

                {/* Custom breed input */}
                {useCustomBreed && (
                  <View style={s.customBreedWrapper}>
                    <TextInput
                      ref={customBreedRef}
                      style={[s.input, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }]}
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
              /* Species with no breeds catalogue — free-text only */
              <TextInput
                ref={customBreedRef}
                style={[s.input, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }]}
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
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.label, { color: colors.mutedForeground }]}>Bio</Text>
          <TextInput
            ref={bioRef}
            style={[s.input, s.bioInput, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.foreground }]}
            value={bio}
            onChangeText={setBio}
            placeholder="A little about them… (optional)"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.primary}
            multiline
            returnKeyType="done"
            blurOnSubmit
            maxLength={500}
          />
        </View>

        {/* ── Error ── */}
        {error ? (
          <Text style={[s.error, { color: colors.destructive }]}>{error}</Text>
        ) : null}

        {/* ── Actions — Cancel + Save ── */}
        <View style={s.actions}>
          <Button
            variant="quiet"
            label="Cancel"
            onPress={() => router.back()}
            disabled={isPending}
            style={{ flex: 1 }}
          />
          <Button
            variant="primary"
            onPress={handleSave}
            disabled={!canSave}
            style={{ flex: 2 }}
          >
            {isPending ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.foreground }}>
                Save
              </Text>
            )}
          </Button>
        </View>

        {/* ── Delete zone — visually separated from Save/Cancel ── */}
        <View style={[s.deleteDivider, { borderTopColor: colors.border }]} />
        <View style={s.deleteZone}>
          <Button
            variant="quiet"
            label="delete this pet"
            onPress={() => setDeleteConfirmVisible(true)}
            disabled={isPending || isDeleting}
          />
        </View>
      </ScrollView>

      {/* ── Delete confirm modal ── */}
      {/* Outer View (not Pressable) so no touch events propagate through the
          backdrop to buttons behind the modal, eliminating the double-dialog. */}
      <Modal
        visible={deleteConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!isDeleting) setDeleteConfirmVisible(false); }}
      >
        <View style={s.deleteOverlay}>
          <View
            style={[s.deleteCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[s.deleteCardTitle, { color: colors.foreground }]}>
              {`delete ${pet.name}?`}
            </Text>
            <Text style={[s.deleteCardBody, { color: colors.mutedForeground }]}>
              {totalPosts > 0
                ? `this removes their profile and all ${totalPosts} post${totalPosts === 1 ? '' : 's'}. this can't be undone.`
                : `this removes their profile. this can't be undone.`}
            </Text>
            <View style={s.deleteCardActions}>
              <Button
                variant="quiet"
                label="cancel"
                onPress={() => setDeleteConfirmVisible(false)}
                disabled={isDeleting}
                style={{ flex: 1 }}
              />
              <Button
                variant="primary"
                onPress={handleConfirmDelete}
                disabled={isDeleting}
                style={{ flex: 2 }}
              >
                {isDeleting ? (
                  <ActivityIndicator color={colors.foreground} />
                ) : (
                  <Text style={{ fontSize: 16, color: colors.foreground }}>
                    <Text style={{ fontFamily: 'Inter_600SemiBold' }}>delete</Text>
                    <Text style={{ fontFamily: 'Inter_500Medium' }}>{` ${pet.name}`}</Text>
                  </Text>
                )}
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  scroll:  { flexGrow: 1, paddingHorizontal: 20 },

  backBtn: {
    position:       'absolute',
    left:           14,
    zIndex:         10,
    width:          38,
    height:         38,
    alignItems:     'center',
    justifyContent: 'center',
  },

  title: {
    fontFamily:    'Inter_700Bold',
    fontSize:      28,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize:   15,
    marginTop:  4,
    marginBottom: 24,
  },

  card: {
    borderRadius: 16,
    borderWidth:  StyleSheet.hairlineWidth,
    padding:      20,
    marginBottom: 14,
  },
  label: {
    fontFamily:    'Inter_500Medium',
    fontSize:      13,
    marginBottom:  10,
    letterSpacing: 0.2,
  },
  input: {
    borderWidth:       StyleSheet.hairlineWidth,
    borderRadius:      12,
    paddingHorizontal: 14,
    paddingVertical:   Platform.OS === 'ios' ? 13 : 10,
    fontFamily:        'Inter_400Regular',
    fontSize:          15,
  },
  bioInput: {
    minHeight:         80,
    textAlignVertical: 'top',
    paddingTop:        12,
  },

  // Species chips
  chipScroll: { marginTop: 2 },
  chipRow:    { gap: 8, paddingRight: 4 },
  chip: {
    borderWidth:       StyleSheet.hairlineWidth,
    borderRadius:      20,
    paddingHorizontal: 14,
    paddingVertical:   8,
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize:   14,
  },

  // Breed search
  searchBox: {
    flexDirection:  'row',
    alignItems:     'center',
    borderWidth:    StyleSheet.hairlineWidth,
    borderRadius:   12,
    paddingHorizontal: 10,
    marginBottom:   8,
  },
  searchIcon:  { marginRight: 6 },
  searchInput: {
    flex:            1,
    fontFamily:      'Inter_400Regular',
    fontSize:        15,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
  },

  // Breed list
  breedListWrapper: {
    borderWidth:  StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow:     'hidden',
    maxHeight:    240,
  },
  breedList: { flexGrow: 0 },
  breedRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 14,
    paddingVertical:   12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  breedRowText: {
    fontFamily: 'Inter_500Medium',
    fontSize:   14,
    flex:       1,
  },

  // Custom breed
  customBreedWrapper: { marginTop: 10 },
  customBreedHint: {
    fontFamily: 'Inter_400Regular',
    fontSize:   12,
    marginTop:  6,
    lineHeight: 16,
  },

  // Actions row
  error: {
    fontFamily:   'Inter_400Regular',
    fontSize:     13,
    textAlign:    'center',
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    gap:           10,
    marginTop:     4,
  },

  // Delete zone
  deleteDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop:      28,
    marginBottom:   12,
  },
  deleteZone: {
    alignItems:    'center',
    marginBottom:  32,
  },

  // Delete confirm modal
  deleteOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems:      'center',
    justifyContent:  'center',
    padding:         32,
  },
  deleteCard: {
    width:        '100%',
    borderRadius: 16,
    borderWidth:  StyleSheet.hairlineWidth,
    padding:      24,
  },
  deleteCardTitle: {
    fontFamily:   'Inter_600SemiBold',
    fontSize:     18,
    marginBottom: 10,
  },
  deleteCardBody: {
    fontFamily:   'Inter_400Regular',
    fontSize:     14,
    lineHeight:   20,
    marginBottom: 24,
  },
  deleteCardActions: {
    flexDirection: 'row',
    gap:           10,
  },
});
