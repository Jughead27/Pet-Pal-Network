/**
 * Profile tab — shows the signed-in user's pets and their full follow graph.
 *
 * My Pets section:
 *   Empty state  → "Create a pet" prompt
 *   Has pets     → scrollable list + "Add another pet" button
 *
 * Following section:
 *   Packed pets     → tappable rows (navigate to pet profile) + Leave Pack button
 *   Followed species/breeds → rows with Unfollow button
 *
 * All unfollow actions are optimistic: context updates immediately, followed by
 * a server mutation and cache invalidation of the follows list.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import {
  useGetMyPets,
  useGetMyFollows,
  useUnfollowSpecies,
  useUnfollowBreed,
  useLeavePetPack,
  getGetMyFollowsQueryKey,
} from '@workspace/api-client-react';
import type { Pet, PackedPetItem, FollowedSpeciesItem, FollowedBreedItem } from '@workspace/api-client-react';
import { useFollowsContext } from '@/context/FollowsContext';
import { usePackContext } from '@/context/PackContext';

export default function ProfileScreen() {
  const colors    = useColors();
  const insets    = useSafeAreaInsets();
  const topInset  = Platform.OS === 'web' ? 67 : insets.top;
  const qc        = useQueryClient();

  const { data: petsData, isLoading: petsLoading, isError: petsError } = useGetMyPets();
  const { data: followsData, isLoading: followsLoading }               = useGetMyFollows();
  const pets = petsData?.pets ?? [];

  const { setSpeciesFollow, setBreedFollow } = useFollowsContext();
  const { setPackState }                     = usePackContext();

  const { mutate: unfollowSpecies } = useUnfollowSpecies();
  const { mutate: unfollowBreed }   = useUnfollowBreed();
  const { mutate: leavePetPack }    = useLeavePetPack();

  // Track which items are pending an unfollow mutation (to show loading state / prevent double-tap)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const addPending    = (id: string) => setPendingIds((s) => new Set(s).add(id));
  const removePending = (id: string) => setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });

  const invalidateFollows = useCallback(() => {
    qc.invalidateQueries({ queryKey: getGetMyFollowsQueryKey() });
  }, [qc]);

  const handleUnfollowSpecies = useCallback((item: FollowedSpeciesItem) => {
    if (pendingIds.has(item.id)) return;
    addPending(item.id);
    setSpeciesFollow(item.id, false);
    unfollowSpecies(
      { id: item.id },
      {
        onSuccess: () => { invalidateFollows(); removePending(item.id); },
        onError:   () => { setSpeciesFollow(item.id, true); removePending(item.id); },
      },
    );
  }, [pendingIds, setSpeciesFollow, unfollowSpecies, invalidateFollows]);

  const handleUnfollowBreed = useCallback((item: FollowedBreedItem) => {
    if (pendingIds.has(item.id)) return;
    addPending(item.id);
    setBreedFollow(item.id, false);
    unfollowBreed(
      { id: item.id },
      {
        onSuccess: () => { invalidateFollows(); removePending(item.id); },
        onError:   () => { setBreedFollow(item.id, true); removePending(item.id); },
      },
    );
  }, [pendingIds, setBreedFollow, unfollowBreed, invalidateFollows]);

  const handleLeavePackFromFollows = useCallback((pet: PackedPetItem) => {
    if (pendingIds.has(pet.id)) return;
    addPending(pet.id);
    setPackState(pet.id, false);
    leavePetPack(
      { id: pet.id },
      {
        onSuccess: () => { invalidateFollows(); removePending(pet.id); },
        onError:   () => { setPackState(pet.id, true); removePending(pet.id); },
      },
    );
  }, [pendingIds, setPackState, leavePetPack, invalidateFollows]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (petsLoading) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.background, paddingTop: topInset }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (petsError) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.background, paddingTop: topInset }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
          Could not load your pets.
        </Text>
      </View>
    );
  }

  const packedPets      = followsData?.packedPets      ?? [];
  const followedSpecies = followsData?.followedSpecies  ?? [];
  const followedBreeds  = followsData?.followedBreeds   ?? [];
  const hasFollows      = packedPets.length > 0 || followedSpecies.length > 0 || followedBreeds.length > 0;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topInset + 16, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ══════════════ MY PETS ══════════════ */}
        <Text style={[styles.heading, { color: colors.foreground }]}>My Pets</Text>

        {pets.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="heart" size={32} color={colors.mutedForeground} style={{ marginBottom: 12 }} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No pets yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
              Add your first pet and start sharing their story.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}
              onPress={() => router.push('/pet/create')}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                Create a pet
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.listGap}>
              {pets.map((pet) => (
                <PetRow
                  key={pet.id}
                  pet={pet}
                  colors={colors}
                  onPress={() => router.push(`/pet/${pet.id}`)}
                />
              ))}
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.addBtn,
                { borderColor: colors.border, backgroundColor: colors.card },
                pressed && styles.pressed,
              ]}
              onPress={() => router.push('/pet/create')}
            >
              <Feather name="plus" size={16} color={colors.foreground} />
              <Text style={[styles.addBtnText, { color: colors.foreground }]}>Add another pet</Text>
            </Pressable>
          </>
        )}

        {/* ══════════════ FOLLOWING ══════════════ */}
        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
        <Text style={[styles.heading, { color: colors.foreground }]}>Following</Text>

        {followsLoading ? (
          <View style={styles.followsLoading}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        ) : !hasFollows ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="users" size={28} color={colors.mutedForeground} style={{ marginBottom: 10 }} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing followed yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
              Follow pets, species, and breeds from their profiles.
            </Text>
          </View>
        ) : (
          <View style={styles.listGap}>
            {/* ── Pets in Pack ── */}
            {packedPets.length > 0 && (
              <>
                <Text style={[styles.subheading, { color: colors.mutedForeground }]}>Pets in Pack</Text>
                {packedPets.map((item) => (
                  <FollowRow
                    key={`pack-${item.id}`}
                    primaryText={item.name}
                    secondaryText={item.breed ? `${item.species} · ${item.breed}` : item.species}
                    onRowPress={() => router.push(`/pet/${item.id}`)}
                    onUnfollow={() => handleLeavePackFromFollows(item)}
                    isPending={pendingIds.has(item.id)}
                    unfollowLabel="Leave Pack"
                    colors={colors}
                  />
                ))}
              </>
            )}

            {/* ── Followed Species ── */}
            {followedSpecies.length > 0 && (
              <>
                <Text style={[styles.subheading, { color: colors.mutedForeground }]}>Species</Text>
                {followedSpecies.map((item) => (
                  <FollowRow
                    key={`species-${item.id}`}
                    primaryText={item.name}
                    onUnfollow={() => handleUnfollowSpecies(item)}
                    isPending={pendingIds.has(item.id)}
                    colors={colors}
                  />
                ))}
              </>
            )}

            {/* ── Followed Breeds ── */}
            {followedBreeds.length > 0 && (
              <>
                <Text style={[styles.subheading, { color: colors.mutedForeground }]}>Breeds</Text>
                {followedBreeds.map((item) => (
                  <FollowRow
                    key={`breed-${item.id}`}
                    primaryText={item.name}
                    secondaryText={item.speciesName}
                    onUnfollow={() => handleUnfollowBreed(item)}
                    isPending={pendingIds.has(item.id)}
                    colors={colors}
                  />
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── PetRow ────────────────────────────────────────────────────────────────────

interface PetRowProps {
  pet:     Pet;
  colors:  ReturnType<typeof useColors>;
  onPress: () => void;
}

function PetRow({ pet, colors, onPress }: PetRowProps) {
  const subtitle = pet.breed ? `${pet.species} · ${pet.breed}` : pet.species;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`View ${pet.name}'s profile`}
      style={[styles.petRow, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.petAvatar, { backgroundColor: colors.secondary }]}>
        <Feather name="heart" size={18} color={colors.mutedForeground} />
      </View>
      <View style={styles.petInfo}>
        <Text style={[styles.petName, { color: colors.foreground }]}>{pet.name}</Text>
        <Text style={[styles.petSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// ── FollowRow — generic follow item with optional navigation + unfollow ────────

interface FollowRowProps {
  primaryText:    string;
  secondaryText?: string;
  onRowPress?:    () => void;
  onUnfollow:     () => void;
  isPending:      boolean;
  unfollowLabel?: string;
  colors:         ReturnType<typeof useColors>;
}

function FollowRow({
  primaryText,
  secondaryText,
  onRowPress,
  onUnfollow,
  isPending,
  unfollowLabel = 'Unfollow',
  colors,
}: FollowRowProps) {
  return (
    <View style={[styles.followRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Tappable area (left + center) */}
      <TouchableOpacity
        onPress={onRowPress}
        activeOpacity={onRowPress ? 0.7 : 1}
        disabled={!onRowPress}
        style={styles.followRowContent}
      >
        <View style={styles.petInfo}>
          <Text style={[styles.petName, { color: colors.foreground }]} numberOfLines={1}>
            {primaryText}
          </Text>
          {secondaryText ? (
            <Text style={[styles.petSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {secondaryText}
            </Text>
          ) : null}
        </View>
        {onRowPress && (
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={{ marginRight: 8 }} />
        )}
      </TouchableOpacity>

      {/* Unfollow button */}
      <TouchableOpacity
        onPress={onUnfollow}
        disabled={isPending}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={unfollowLabel}
        style={[
          styles.unfollowBtn,
          { borderColor: colors.border },
          isPending && { opacity: 0.5 },
        ]}
      >
        {isPending ? (
          <ActivityIndicator size={12} color={colors.mutedForeground} />
        ) : (
          <Text style={[styles.unfollowBtnText, { color: colors.mutedForeground }]}>
            {unfollowLabel}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  scroll:  { flexGrow: 1, paddingHorizontal: 20 },

  heading: {
    fontFamily:    'Inter_700Bold',
    fontSize:      26,
    letterSpacing: -0.3,
    marginBottom:  20,
  },
  subheading: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom:  6,
    marginTop:     4,
  },

  sectionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 24,
  },

  followsLoading: {
    alignItems:  'center',
    paddingVertical: 20,
  },

  // Empty state
  emptyCard: {
    borderRadius: 16,
    borderWidth:  StyleSheet.hairlineWidth,
    padding:      32,
    alignItems:   'center',
    marginTop:    8,
  },
  emptyTitle: {
    fontFamily:   'Inter_600SemiBold',
    fontSize:     17,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily:  'Inter_400Regular',
    fontSize:    14,
    lineHeight:  20,
    textAlign:   'center',
    marginBottom: 24,
  },

  // Buttons
  primaryBtn: {
    borderRadius:    10,
    paddingVertical: 13,
    paddingHorizontal: 28,
    alignItems:      'center',
    alignSelf:       'stretch',
  },
  primaryBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  addBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    borderWidth:     StyleSheet.hairlineWidth,
    borderRadius:    10,
    paddingVertical: 13,
    marginTop:       12,
  },
  addBtnText: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  pressed: { opacity: 0.75 },

  // Pet row
  listGap: { gap: 8 },
  petRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           14,
    borderRadius:  12,
    borderWidth:   StyleSheet.hairlineWidth,
    padding:       14,
  },
  petAvatar: {
    width:          44,
    height:         44,
    borderRadius:   22,
    alignItems:     'center',
    justifyContent: 'center',
  },
  petInfo:    { flex: 1, gap: 3 },
  petName:    { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  petSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 13 },

  // Follow row
  followRow: {
    flexDirection:  'row',
    alignItems:     'center',
    borderRadius:   12,
    borderWidth:    StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingLeft:    14,
    paddingRight:   10,
    gap:            8,
  },
  followRowContent: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
  },
  unfollowBtn: {
    borderWidth:      StyleSheet.hairlineWidth,
    borderRadius:     8,
    paddingVertical:  6,
    paddingHorizontal: 10,
    minWidth:         72,
    alignItems:       'center',
    justifyContent:   'center',
  },
  unfollowBtnText: {
    fontFamily:    'Inter_500Medium',
    fontSize:      12,
    letterSpacing: 0.1,
  },
});
