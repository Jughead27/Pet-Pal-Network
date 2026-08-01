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

import React, { useCallback, useMemo, useRef, useState } from 'react';
import FeedbackFlow from '@/components/FeedbackFlow';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuth } from '@clerk/clerk-expo';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import Button from '@/components/Button';
import MediaImage from '@/components/MediaImage';
import {
  useGetMyPets,
  useGetMyFollows,
  useGetMe,
  useUnfollowSpecies,
  useUnfollowBreed,
  useLeavePetPack,
  getGetMyFollowsQueryKey,
  getBaseUrl,
  customFetch,
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
  const { data: meData }                                                = useGetMe();
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
  const [confirmSignOut,  setConfirmSignOut]  = useState(false);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [pendingBlockIds, setPendingBlockIds] = useState<Set<string>>(new Set());
  const addPendingBlock    = (id: string) => setPendingBlockIds((s) => new Set(s).add(id));
  const removePendingBlock = (id: string) => setPendingBlockIds((s) => { const n = new Set(s); n.delete(id); return n; });

  // Blocked owners list — loaded lazily, always fresh on mount
  const { data: blocksData, refetch: refetchBlocks } = useQuery({
    queryKey: ['my-blocks'],
    queryFn:  () => customFetch<{ blocks: { userId: string; username: string | null; blockedAt: string }[] }>('/api/blocks'),
  });
  const blockedList = blocksData?.blocks ?? [];

  // Co-owner invite data — pending invites sent to the viewer by pet primary owners
  const { data: coOwnerInviteData, refetch: refetchCoOwnerInvites } = useQuery({
    queryKey: ['my-co-owner-invites'],
    queryFn:  () => customFetch<{
      invites: Array<{
        id: string;
        petId: string;
        petName: string;
        inviterUsername: string;
        createdAt: string;
      }>;
    }>('/api/me/co-owner-invites'),
  });
  const [coOwnerActingIds, setCoOwnerActingIds] = useState<Set<string>>(new Set());
  const coOwnerInvites = coOwnerInviteData?.invites ?? [];

  const handleCoOwnerAccept = useCallback(async (inviteId: string, petId: string) => {
    if (coOwnerActingIds.has(inviteId)) return;
    setCoOwnerActingIds((s) => new Set(s).add(inviteId));
    try {
      await customFetch(`/api/co-owner-invites/${inviteId}/accept`, { method: 'POST' });
      await refetchCoOwnerInvites();
      qc.invalidateQueries({ queryKey: ['my-pets'] });
    } catch { /* silent */ } finally {
      setCoOwnerActingIds((s) => { const n = new Set(s); n.delete(inviteId); return n; });
    }
  }, [coOwnerActingIds, refetchCoOwnerInvites, qc]);

  const handleCoOwnerDecline = useCallback(async (inviteId: string) => {
    if (coOwnerActingIds.has(inviteId)) return;
    setCoOwnerActingIds((s) => new Set(s).add(inviteId));
    try {
      await customFetch(`/api/co-owner-invites/${inviteId}/decline`, { method: 'POST' });
      await refetchCoOwnerInvites();
    } catch { /* silent */ } finally {
      setCoOwnerActingIds((s) => { const n = new Set(s); n.delete(inviteId); return n; });
    }
  }, [coOwnerActingIds, refetchCoOwnerInvites]);

  // Invite data query
  const { data: inviteData, refetch: refetchInvites } = useQuery({
    queryKey: ['my-invites'],
    queryFn:  () => customFetch<{
      effectiveQuota:    number;
      invitedByUsername: string | null;
      nonRevokedCount:   number;
      invites: {
        id: string; code: string; status: 'active' | 'used' | 'revoked';
        createdAt: string; usedByUsername: string | null;
      }[];
      friendsWhoJoined: {
        userId: string; username: string | null;
        pets: { id: string; name: string; thumbnailUrl: string | null }[];
      }[];
    }>('/api/invites/mine'),
  });
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [revokingIds, setRevokingIds]       = useState<Set<string>>(new Set());
  const [revokeToast, setRevokeToast]       = useState(false);
  const revokeToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUnblock = useCallback(async (userId: string) => {
    if (pendingBlockIds.has(userId)) return;
    addPendingBlock(userId);
    try {
      await customFetch(`/api/blocks/${userId}`, { method: 'DELETE' });
      await refetchBlocks();
    } finally {
      removePendingBlock(userId);
    }
  }, [pendingBlockIds, refetchBlocks]);

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

  // ── Invite handlers ──────────────────────────────────────────────────────
  const handleCallInFriend = useCallback(async () => {
    if (creatingInvite) return;
    setCreatingInvite(true);
    try {
      const result = await customFetch<{ ok: boolean; invite: { id: string; code: string } }>(
        '/api/invites', { method: 'POST' },
      );
      const link    = `https://pshpsh.net/invite/${result.invite.code}`;
      const message = `you've been called. ${link}`;
      if (Platform.OS === 'web') {
        // Web Share API with clipboard fallback
        try {
          await (navigator as unknown as { share(o: object): Promise<void> }).share({ text: message, url: link });
        } catch {
          try {
            await (navigator as unknown as { clipboard: { writeText(s: string): Promise<void> } }).clipboard.writeText(link);
          } catch { /* silent */ }
        }
      } else {
        await Share.share({ message });
      }
      await refetchInvites();
    } catch { /* silent — quota exceeded or network error */ } finally {
      setCreatingInvite(false);
    }
  }, [creatingInvite, refetchInvites]);

  const handleRevoke = useCallback(async (inviteId: string) => {
    setRevokingIds((prev) => new Set(prev).add(inviteId));
    try {
      await customFetch(`/api/invites/${inviteId}/revoke`, { method: 'POST' });
      await refetchInvites();
      // Brief confirmation toast — slot is now freed, count updates via refetch
      if (revokeToastTimer.current) clearTimeout(revokeToastTimer.current);
      setRevokeToast(true);
      revokeToastTimer.current = setTimeout(() => setRevokeToast(false), 2500);
    } catch { /* silent */ } finally {
      setRevokingIds((prev) => { const s = new Set(prev); s.delete(inviteId); return s; });
    }
  }, [refetchInvites]);

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

  // Invite derived values
  const effectiveQuota   = inviteData?.effectiveQuota ?? 0;
  const nonRevokedCount  = inviteData?.nonRevokedCount ?? 0;
  const remaining        = effectiveQuota - nonRevokedCount;
  const pendingInvites   = (inviteData?.invites ?? []).filter((i) => i.status === 'active');
  const friendsWhoJoined = inviteData?.friendsWhoJoined ?? [];

  // Owner header visibility helpers
  const hasDisplayName  = Boolean(meData?.displayName);
  const hasCity         = Boolean(meData?.locationCity);
  const hasAbout        = Boolean(meData?.about);
  const usernameUnset   = meData !== undefined && meData.username === null;
  const showOwnerHeader = hasDisplayName || hasCity || hasAbout || usernameUnset;

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

        {/* ══════════════ OWNER HEADER ══════════════ */}
        {showOwnerHeader && (
          <View style={styles.ownerBlock}>
            {hasDisplayName && (
              <Text style={[styles.ownerDisplayName, { color: colors.foreground }]}>
                {meData!.displayName}
              </Text>
            )}
            {hasCity && (
              <Text style={[styles.ownerMeta, { color: colors.mutedForeground }]}>
                {meData!.locationCity}
              </Text>
            )}
            {hasAbout && (
              <Text style={[styles.ownerAbout, { color: colors.mutedForeground }]}>
                {meData!.about}
              </Text>
            )}
            {usernameUnset && (
              <TouchableOpacity
                onPress={() => router.push('/profile/edit')}
                activeOpacity={0.7}
                accessibilityRole="link"
                accessibilityLabel="Choose a username"
              >
                <Text style={[styles.chooseUsername, { color: colors.mutedForeground }]}>
                  Choose a username
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Edit profile — typographic, always visible on own profile */}
        <TouchableOpacity
          onPress={() => router.push('/profile/edit')}
          activeOpacity={0.7}
          style={[
            styles.editProfileRow,
            showOwnerHeader && styles.editProfileRowSpaced,
          ]}
          accessibilityRole="link"
          accessibilityLabel="Edit profile"
        >
          <Text style={[styles.editProfileText, { color: colors.mutedForeground }]}>
            Edit profile
          </Text>
        </TouchableOpacity>

        {/* Admin link — only visible to admins; quiet, no decoration */}
        {(meData as unknown as { role?: string } | undefined)?.role === 'admin' && (
          <TouchableOpacity
            onPress={() => router.push('/admin')}
            activeOpacity={0.7}
            style={styles.editProfileRow}
            accessibilityRole="link"
            accessibilityLabel="Admin area"
          >
            <Text style={[styles.editProfileText, { color: colors.mutedForeground }]}>
              admin
            </Text>
          </TouchableOpacity>
        )}

        {/* ══════════════ MY PETS ══════════════ */}
        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
        <Text style={[styles.heading, { color: colors.foreground }]}>My Pets</Text>

        {pets.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="heart" size={32} color={colors.mutedForeground} style={{ marginBottom: 12 }} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No pets yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
              Add your first pet and start sharing their story.
            </Text>
            <Button
              variant="primary"
              label="Create a pet"
              fullWidth
              onPress={() => router.push('/pet/create')}
            />
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
            <Button
              variant="primary"
              label="Add another pet"
              fullWidth
              onPress={() => router.push('/pet/create')}
              style={{ marginTop: 12 }}
            />
          </>
        )}

        {/* ══════════════ CO-OWNER INVITES ══════════════ */}
        {coOwnerInvites.length > 0 && (
          <>
            <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
            <Text style={[styles.heading, { color: colors.foreground }]}>Co-owner invites</Text>
            <View style={styles.listGap}>
              {coOwnerInvites.map((inv) => (
                <View
                  key={inv.id}
                  style={[styles.inviteCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.inviteCardText, { color: colors.foreground }]}>
                    {inv.inviterUsername} wants to share {inv.petName} with you.
                  </Text>
                  <View style={styles.inviteCardActions}>
                    <TouchableOpacity
                      onPress={() => handleCoOwnerDecline(inv.id)}
                      disabled={coOwnerActingIds.has(inv.id)}
                      style={[styles.inviteCardBtn, { borderColor: colors.border }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Decline co-owner invite for ${inv.petName}`}
                    >
                      <Text style={[styles.inviteCardBtnText, { color: colors.mutedForeground }]}>decline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleCoOwnerAccept(inv.id, inv.petId)}
                      disabled={coOwnerActingIds.has(inv.id)}
                      style={[styles.inviteCardBtn, { borderColor: colors.primary }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Accept co-owner invite for ${inv.petName}`}
                    >
                      {coOwnerActingIds.has(inv.id) ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Text style={[styles.inviteCardBtnText, { color: colors.primary }]}>accept</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => router.push(`/pet/${inv.petId}`)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                    accessibilityRole="link"
                    accessibilityLabel={`View ${inv.petName}'s profile`}
                  >
                    <Text style={[styles.inviteCardPetLink, { color: colors.mutedForeground }]}>
                      view {inv.petName}'s profile →
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
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
                    unfollowLabel="Leave"
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

        {/* ══════════════ BLOCKED OWNERS ══════════════ */}
        {blockedList.length > 0 && (
          <>
            <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
            <Text style={[styles.heading, { color: colors.foreground }]}>Blocked Owners</Text>
            <View style={styles.listGap}>
              {blockedList.map((item) => (
                <View
                  key={item.userId}
                  style={[styles.followRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                >
                  <View style={styles.followRowContent}>
                    <Text style={[styles.petName, { color: colors.foreground }]}>
                      {item.username ?? item.userId}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleUnblock(item.userId)}
                    disabled={pendingBlockIds.has(item.userId)}
                    style={styles.quietAction}
                    accessibilityRole="button"
                    accessibilityLabel={`Unblock ${item.username ?? 'user'}`}
                  >
                    <Text style={[
                      styles.quietActionText,
                      {
                        color:   colors.mutedForeground,
                        opacity: pendingBlockIds.has(item.userId) ? 0.4 : 1,
                      },
                    ]}>
                      unblock
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ══════════════ YOUR INVITES ══════════════ */}
        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
        <Text style={[styles.heading, { color: colors.foreground }]}>Your Invites</Text>

        {/* (a) COUNT — hero: remaining slots + hairline CTA */}
        {effectiveQuota > 0 && (
          <>
            <Text style={[styles.inviteHeroText, { color: colors.foreground }]}>
              {remaining > 0
                ? `you can call in ${remaining} ${remaining === 1 ? 'friend' : 'friends'}`
                : 'all your friends are in'}
            </Text>
            {remaining > 0 && (
              <Button
                variant="primary"
                label={creatingInvite ? undefined : 'call in a friend'}
                onPress={handleCallInFriend}
                disabled={creatingInvite}
                style={{ alignSelf: 'flex-start', marginTop: 14, marginBottom: 4 }}
              >
                {creatingInvite && <ActivityIndicator size={14} color={colors.foreground} />}
              </Button>
            )}
          </>
        )}

        {/* Brief revoke confirmation toast */}
        {revokeToast && (
          <Text style={[styles.revokeToast, { color: colors.mutedForeground }]}>
            invite cancelled
          </Text>
        )}

        {/* (b) PENDING — only outstanding active invites; revoked/used hidden */}
        {pendingInvites.length > 0 && (
          <>
            <Text style={[styles.subheading, { color: colors.mutedForeground, marginTop: 22 }]}>
              Pending
            </Text>
            <View style={styles.listGap}>
              {pendingInvites.map((invite) => (
                <View
                  key={invite.id}
                  style={[styles.followRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                >
                  <View style={styles.followRowContent}>
                    <View style={styles.petInfo}>
                      <Text style={[styles.petName, { color: colors.foreground }]}>pending</Text>
                      <Text style={[styles.petSubtitle, { color: colors.mutedForeground }]}>
                        {invite.code}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRevoke(invite.id)}
                    disabled={revokingIds.has(invite.id)}
                    style={[styles.quietAction, revokingIds.has(invite.id) && { opacity: 0.4 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Revoke invite"
                  >
                    {revokingIds.has(invite.id)
                      ? <ActivityIndicator size={12} color={colors.mutedForeground} />
                      : <Text style={[styles.quietActionText, { color: colors.mutedForeground }]}>revoke</Text>}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

        {/* (c) FRIENDS WHO JOINED — one row per redeemer, pet-avatar faced */}
        {friendsWhoJoined.length > 0 && (
          <>
            <Text style={[styles.subheading, { color: colors.mutedForeground, marginTop: 22 }]}>
              Friends who joined
            </Text>
            <View style={styles.listGap}>
              {friendsWhoJoined.map((friend) => (
                <View
                  key={friend.userId}
                  style={[styles.followRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                >
                  <View style={styles.followRowContent}>
                    <FriendAvatarCluster pets={friend.pets} colors={colors} />
                    <View style={styles.petInfo}>
                      <Text style={[styles.petName, { color: colors.foreground }]}>
                        {friend.username ?? 'your friend'}
                      </Text>
                      {friend.pets.length === 1 && (
                        <Text style={[styles.petSubtitle, { color: colors.mutedForeground }]}>
                          {friend.pets[0].name}
                        </Text>
                      )}
                      {friend.pets.length > 1 && (
                        <Text
                          style={[styles.petSubtitle, { color: colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          {friend.pets.map((p) => p.name).join(', ')}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ══════════════ SIGN OUT ══════════════ */}
        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />

        {/* Send feedback — quiet whisper-weight entry, above sign out */}
        {!confirmSignOut && (
          <TouchableOpacity
            onPress={() => setFeedbackVisible(true)}
            activeOpacity={0.7}
            style={styles.feedbackRow}
            accessibilityRole="button"
            accessibilityLabel="Send feedback"
          >
            <Text style={[styles.feedbackText, { color: colors.mutedForeground }]}>
              send feedback
            </Text>
          </TouchableOpacity>
        )}

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

      {/* Feedback modal — portal visual system */}
      <FeedbackFlow
        visible={feedbackVisible}
        onClose={() => setFeedbackVisible(false)}
      />
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
      {/* Tappable content area — takes all remaining space */}
      <TouchableOpacity
        onPress={onRowPress}
        activeOpacity={onRowPress ? 0.7 : 1}
        disabled={!onRowPress}
        style={styles.followRowContent}
      >
        {thumbnailUrl !== undefined && (
          <PetThumbnail thumbnailUrl={thumbnailUrl} size={40} colors={colors} />
        )}
        {/* Name + species/breed column takes flex priority — name never truncates */}
        <View style={styles.petInfo}>
          <Text style={[styles.petName, { color: colors.foreground }]}>
            {primaryText}
          </Text>
          {secondaryText ? (
            <Text
              style={[styles.petSubtitle, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {secondaryText}
            </Text>
          ) : null}
        </View>
        {/* No chevron — this row carries a trailing action */}
      </TouchableOpacity>

      {/* Quiet typographic action — no border, no background, ≥44 px touch target */}
      <TouchableOpacity
        onPress={onUnfollow}
        disabled={isPending}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={unfollowLabel}
        style={[styles.quietAction, isPending && { opacity: 0.4 }]}
      >
        {isPending ? (
          <ActivityIndicator size={12} color={colors.mutedForeground} />
        ) : (
          <Text style={[styles.quietActionText, { color: colors.mutedForeground }]}>
            {unfollowLabel}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── FriendAvatarCluster ───────────────────────────────────────────────────────

interface FriendPet {
  id:           string;
  name:         string;
  thumbnailUrl: string | null;
}

interface FriendAvatarClusterProps {
  pets:   FriendPet[];
  colors: ReturnType<typeof useColors>;
}

/**
 * Pet-avatar cluster for a "friends who joined" row.
 *   0 pets  → paw-outline placeholder (40 px)
 *   1 pet   → single avatar (40 px)
 *   2+ pets → overlapping 32 px circles, max 3 shown; "+N" badge for extras
 */
function FriendAvatarCluster({ pets, colors }: FriendAvatarClusterProps) {
  if (pets.length === 0) {
    return (
      <View
        style={{
          width: 40, height: 40, borderRadius: 20,
          backgroundColor: colors.secondary,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Ionicons name="paw-outline" size={18} color={colors.mutedForeground} />
      </View>
    );
  }

  if (pets.length === 1) {
    return <PetThumbnail thumbnailUrl={pets[0].thumbnailUrl} size={40} colors={colors} />;
  }

  const CHIP    = 32;
  const STEP    = CHIP - 10; // 10 px overlap between each avatar
  const visible = pets.slice(0, 3);
  const extra   = pets.length - 3;

  return (
    <View style={{ width: CHIP + (visible.length - 1) * STEP, height: CHIP }}>
      {visible.map((pet, i) => (
        <View
          key={pet.id}
          style={{ position: 'absolute', left: i * STEP, zIndex: visible.length - i }}
        >
          <PetThumbnail thumbnailUrl={pet.thumbnailUrl} size={CHIP} colors={colors} />
        </View>
      ))}
      {extra > 0 && (
        <View
          style={{
            position: 'absolute', left: 3 * STEP, zIndex: 0,
            width: CHIP, height: CHIP, borderRadius: CHIP / 2,
            backgroundColor: colors.secondary,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.mutedForeground }}>
            +{extra}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  scroll:  { flexGrow: 1, paddingHorizontal: 20 },

  // Owner header
  ownerBlock: {
    gap: 5,
    marginBottom: 2,
  },
  ownerDisplayName: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      20,
    letterSpacing: -0.2,
  },
  ownerMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize:   14,
  },
  ownerAbout: {
    fontFamily:  'Inter_400Regular',
    fontSize:    14,
    lineHeight:  20,
    marginTop:   2,
  },
  chooseUsername: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    marginTop:  4,
    textDecorationLine: 'underline',
  },
  editProfileRow: {
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  editProfileRowSpaced: {
    marginTop: 10,
  },
  editProfileText: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
  },

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
    paddingRight:    4,   // action button supplies its own horizontal padding
    gap:             4,
  },
  followRowContent: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
    // Shrink only this side — action text never wraps
    flexShrink:    1,
  },
  // Quiet typographic action — no border, no background, invisible padding for ≥44 px target
  quietAction: {
    minHeight:         44,
    minWidth:          44,
    paddingHorizontal: 12,
    paddingVertical:   4,
    alignItems:        'center',
    justifyContent:    'center',
    flexShrink:        0,
  },
  quietActionText: {
    fontFamily:    'Inter_500Medium',
    fontSize:      13,
    letterSpacing: 0.1,
  },

  // Invite section
  // Hero count: "you can call in N friends"
  inviteHeroText: {
    fontFamily:    'Inter_400Regular',
    fontSize:      17,
    lineHeight:    24,
    letterSpacing: -0.1,
  },
  // Brief revoke confirmation — shown for 2.5 s then hides
  revokeToast: {
    fontFamily:   'Inter_400Regular',
    fontSize:     13,
    lineHeight:   20,
    marginTop:    12,
    opacity:      0.75,
  },
  inviteIntro: {
    fontFamily:   'Inter_400Regular',
    fontSize:     15,
    lineHeight:   22,
    marginBottom: 8,
  },
  inviteProgress: {
    fontFamily:   'Inter_400Regular',
    fontSize:     13,
    lineHeight:   20,
    marginBottom: 12,
    opacity:      0.75,
  },
  callInRow: {
    paddingVertical: 10,
    alignSelf:       'flex-start',
    marginBottom:    4,
  },
  callInText: {
    fontFamily: 'Inter_700Bold',
    fontSize:   15,
  },

  // Co-owner invite card (in profile co-owner invites section)
  inviteCard: {
    borderRadius:  10,
    borderWidth:   StyleSheet.hairlineWidth,
    padding:       14,
    gap:           10,
  },
  inviteCardText: {
    fontFamily: 'Inter_400Regular',
    fontSize:   14,
    lineHeight: 20,
  },
  inviteCardActions: {
    flexDirection: 'row',
    gap:           8,
  },
  inviteCardBtn: {
    flex:          1,
    borderWidth:   StyleSheet.hairlineWidth,
    borderRadius:  8,
    paddingVertical: 8,
    alignItems:    'center',
    justifyContent: 'center',
  },
  inviteCardBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize:   13,
  },
  inviteCardPetLink: {
    fontFamily: 'Inter_400Regular',
    fontSize:   12,
    opacity:    0.55,
  },

  // Send feedback — whisper weight, sits above sign-out
  feedbackRow: {
    paddingVertical: 6,
    alignSelf:       'flex-start',
    marginBottom:    8,
  },
  feedbackText: {
    fontFamily:    'Inter_400Regular',
    fontSize:      13,
    opacity:       0.7,
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
