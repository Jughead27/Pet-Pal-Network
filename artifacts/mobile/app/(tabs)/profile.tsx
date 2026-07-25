/**
 * Profile tab — signed-in user's pets, full follow graph, and sign-out.
 *
 * MY PETS section:
 *   Empty state  → "Create a pet" prompt
 *   Has pets     → scrollable list + "Add another pet" button
 *
 * FOLLOWING section:
 *   MY PACK       → tappable pet rows (navigate to pet profile) + Leave Pack
 *   SPECIES       → followed species rows with Unfollow
 *   BREEDS        → followed breed rows with Unfollow
 *
 * SIGN OUT:
 *   Footer row with inline confirmation (cross-platform; no Alert.alert).
 *   Clerk signOut() clears the session; the auth guard in _layout.tsx
 *   then redirects to sign-in automatically.
 *
 * All unfollow actions are optimistic: context updates immediately, then
 * a server mutation runs and cache is invalidated on settle.
 */

import React, { useCallback, useMemo, useState } from 'react';
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
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import MediaImage from '@/components/MediaImage';
import {
  useGetMyPets,
  useGetMyFollows,
  useUnfollowSpecies,
  useUnfollowBreed,
  useLeavePetPack,
  getGetMyFollowsQueryKey,
  getBaseUrl,
} from '@workspace/api-client-react';
import type { Pet, PackedPetItem, FollowedSpeciesItem, FollowedBreedItem } from '@workspace/api-client-react';
import { useFollowsContext } from '@/context/FollowsContext';
import { usePackContext } from '@/context/PackContext';

export default function ProfileScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const qc       = useQueryClient();

  const { signOut } = useAuth();

  const { data: petsData, isLoading: petsLoading, isError: petsError } = useGetMyPets();
  const { data: followsData, isLoading: followsLoading }               = useGetMyFollows();
  const pets = petsData?.pets ?? [];

  const { setSpeciesFollow, setBreedFollow } = useFollowsContext();
  const { setPackState }                     = usePackContext();

  const { mutate: unfollowSpecies } = useUnfollowSpecies();
  const { mutate: unfollowBreed }   = useUnfollowBreed();
  const { mutate: leavePetPack }    = useLeavePetPack();

  // Pending unfollow mutations — prevents double-tap
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const addPending    = (id: string) => setPendingIds((s) => new Set(s).add(id));
  const removePending = (id: string) => setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });

  // Sign-out confirmation state (inline, no Alert — works identically on all platforms)
  const [confirmSignOut, setConfirmSignOut] = useState(false);

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

  const handleSignOut = useCallback(async () => {
    await signOut();
    // The auth guard in (tabs)/_layout.tsx redirects to sign-in automatically.
    // Explicitly push just in case the guard doesn't fire fast enough.
    router.replace('/(auth)/sign-in');
  }, [signOut]);

  // ── Loading ──────────────────────────────────────────────────────────────────
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

        {/* ══════════════ MY PACK ══════════════ */}
        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
        <Text style={[styles.heading, { color: colors.foreground }]}>My Pack</Text>

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

            {/* ── PETS ── */}
            {packedPets.length > 0 && (
              <>
                <Text style={[styles.subheading, { color: colors.mutedForeground }]}>Pets</Text>
                {packedPets.map((item) => (
                  <FollowRow
                    key={`pack-${item.id}`}
                    primaryText={item.name}
                    secondaryText={item.breed ? `${item.species} · ${item.breed}` : item.species}
                    thumbnailUrl={item.thumbnailUrl}
                    onRowPress={() => router.push(`/pet/${item.id}`)}
                    onUnfollow={() => handleLeavePackFromFollows(item)}
                    isPending={pendingIds.has(item.id)}
                    unfollowLabel="Leave Pack"
                    colors={colors}
                  />
                ))}
              </>
            )}

            {/* ── SPECIES ── */}
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

            {/* ── BREEDS ── */}
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

        {/* ══════════════ SIGN OUT ══════════════ */}
        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />

        {confirmSignOut ? (
          // Confirmation row — inline, no modal/Alert, works on all platforms
          <View style={styles.signOutConfirmRow}>
            <Text style={[styles.signOutConfirmText, { color: colors.mutedForeground }]}>
              Sign out?
            </Text>
            <View style={styles.signOutConfirmBtns}>
              <TouchableOpacity
                onPress={() => setConfirmSignOut(false)}
                style={[styles.signOutBtn, { borderColor: colors.border }]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Cancel sign out"
              >
                <Text style={[styles.signOutBtnText, { color: colors.mutedForeground }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSignOut}
                style={[styles.signOutBtn, styles.signOutBtnDestructive, { borderColor: colors.border }]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Confirm sign out"
              >
                <Text style={[styles.signOutBtnText, { color: colors.destructive ?? '#EF4444' }]}>
                  Sign out
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setConfirmSignOut(true)}
            activeOpacity={0.7}
            style={styles.signOutRow}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Feather name="log-out" size={16} color={colors.mutedForeground} />
            <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Sign out</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </View>
  );
}

// ── PetThumbnail ──────────────────────────────────────────────────────────────

interface PetThumbnailProps {
  thumbnailUrl: string | null | undefined;
  size:         number;
  colors:       ReturnType<typeof useColors>;
}

/**
 * Circular pet avatar: shows the pet's latest-post photo when available,
 * or a paw-outline glyph when the pet has no posts or uses a seed key.
 * Handles the native absolute-URL requirement by prepending the base URL.
 */
function PetThumbnail({ thumbnailUrl, size, colors }: PetThumbnailProps) {
  const source = useMemo(() => {
    if (!thumbnailUrl) return null;
    let uri = thumbnailUrl;
    if (Platform.OS !== 'web' && uri.startsWith('/')) {
      uri = (getBaseUrl() ?? '') + uri;
    }
    return { uri };
  }, [thumbnailUrl]);

  if (!source) {
    return (
      <View
        style={{
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: colors.secondary,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Ionicons name="paw-outline" size={Math.round(size * 0.45)} color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <MediaImage
      source={source}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      resizeMode="cover"
    />
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
      <PetThumbnail thumbnailUrl={pet.thumbnailUrl} size={44} colors={colors} />
      <View style={styles.petInfo}>
        <Text style={[styles.petName, { color: colors.foreground }]}>{pet.name}</Text>
        <Text style={[styles.petSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// ── FollowRow ─────────────────────────────────────────────────────────────────

interface FollowRowProps {
  primaryText:    string;
  secondaryText?: string;
  thumbnailUrl?:  string | null;
  onRowPress?:    () => void;
  onUnfollow:     () => void;
  isPending:      boolean;
  unfollowLabel?: string;
  colors:         ReturnType<typeof useColors>;
}

function FollowRow({
  primaryText,
  secondaryText,
  thumbnailUrl,
  onRowPress,
  onUnfollow,
  isPending,
  unfollowLabel = 'Unfollow',
  colors,
}: FollowRowProps) {
  return (
    <View style={[styles.followRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        onPress={onRowPress}
        activeOpacity={onRowPress ? 0.7 : 1}
        disabled={!onRowPress}
        style={styles.followRowContent}
      >
        {thumbnailUrl !== undefined && (
          <PetThumbnail thumbnailUrl={thumbnailUrl} size={40} colors={colors} />
        )}
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
    alignItems:      'center',
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
    fontFamily:   'Inter_400Regular',
    fontSize:     14,
    lineHeight:   20,
    textAlign:    'center',
    marginBottom: 24,
  },

  // Buttons
  primaryBtn: {
    borderRadius:      10,
    paddingVertical:   13,
    paddingHorizontal: 28,
    alignItems:        'center',
    alignSelf:         'stretch',
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
    flexDirection:   'row',
    alignItems:      'center',
    borderRadius:    12,
    borderWidth:     StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingLeft:     14,
    paddingRight:    10,
    gap:             8,
  },
  followRowContent: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  unfollowBtn: {
    borderWidth:       StyleSheet.hairlineWidth,
    borderRadius:      8,
    paddingVertical:   6,
    paddingHorizontal: 10,
    minWidth:          72,
    alignItems:        'center',
    justifyContent:    'center',
  },
  unfollowBtnText: {
    fontFamily:    'Inter_500Medium',
    fontSize:      12,
    letterSpacing: 0.1,
  },

  // Sign out
  signOutRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            10,
    paddingVertical: 12,
  },
  signOutText: {
    fontFamily: 'Inter_400Regular',
    fontSize:   15,
  },
  signOutConfirmRow: {
    gap: 14,
    paddingVertical: 4,
  },
  signOutConfirmText: {
    fontFamily: 'Inter_500Medium',
    fontSize:   14,
  },
  signOutConfirmBtns: {
    flexDirection: 'row',
    gap:           10,
  },
  signOutBtn: {
    borderWidth:       StyleSheet.hairlineWidth,
    borderRadius:      8,
    paddingVertical:   9,
    paddingHorizontal: 16,
    alignItems:        'center',
  },
  signOutBtnDestructive: {
    // Same size; color is applied inline via the destructive palette
  },
  signOutBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize:   14,
  },
});
