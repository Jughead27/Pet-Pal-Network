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
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { PawPrint, Heart, Users, SignOut, CaretRight } from 'phosphor-react-native';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { useAuth } from '@clerk/clerk-expo';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import Button from '@/components/Button';
import PetAvatar from '@/components/PetAvatar';
import {
  useGetMyPets,
  useGetMyFollows,
  useGetMe,
  useUnfollowSpecies,
  useUnfollowBreed,
  useLeavePetPack,
  getGetMyFollowsQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import type { Pet, PackedPetItem, FollowedSpeciesItem, FollowedBreedItem, MeProfile } from '@workspace/api-client-react';
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

  // Co-ownership requests — pending requests sent to the viewer by other owners
  const { data: coOwnerRequestData, refetch: refetchCoOwnerRequests } = useQuery({
    queryKey: ['my-co-ownership-requests'],
    queryFn:  () => customFetch<{
      requests: Array<{
        id: string;
        petId: string;
        petName: string;
        inviterUsername: string;
        createdAt: string;
      }>;
    }>('/api/co-ownership-requests/mine'),
  });
  const [coOwnerActingIds, setCoOwnerActingIds] = useState<Set<string>>(new Set());
  const coOwnerRequests = coOwnerRequestData?.requests ?? [];

  const handleCoOwnerAccept = useCallback(async (requestId: string, petId: string) => {
    if (coOwnerActingIds.has(requestId)) return;
    setCoOwnerActingIds((s) => new Set(s).add(requestId));
    try {
      await customFetch(`/api/co-ownership-requests/${requestId}/accept`, { method: 'POST' });
      await refetchCoOwnerRequests();
      qc.invalidateQueries({ queryKey: ['my-pets'] });
    } catch { /* silent */ } finally {
      setCoOwnerActingIds((s) => { const n = new Set(s); n.delete(requestId); return n; });
    }
  }, [coOwnerActingIds, refetchCoOwnerRequests, qc]);

  const handleCoOwnerDecline = useCallback(async (requestId: string) => {
    if (coOwnerActingIds.has(requestId)) return;
    setCoOwnerActingIds((s) => new Set(s).add(requestId));
    try {
      await customFetch(`/api/co-ownership-requests/${requestId}/decline`, { method: 'POST' });
      await refetchCoOwnerRequests();
    } catch { /* silent */ } finally {
      setCoOwnerActingIds((s) => { const n = new Set(s); n.delete(requestId); return n; });
    }
  }, [coOwnerActingIds, refetchCoOwnerRequests]);

  // Invite data query
  const { data: inviteData, refetch: refetchInvites } = useQuery({
    queryKey: ['my-invites'],
    queryFn:  () => customFetch<{
      effectiveQuota:    number;
      isAdmin:           boolean;        // server-sourced; no /me race
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

  // Pet co-ownership picker — shown before invite creation when user owns ≥1 pet
  const [petPickerVisible,  setPetPickerVisible]  = useState(false);
  const [selectedCoPetIds,  setSelectedCoPetIds]  = useState<Set<string>>(new Set());

  // isAdmin comes from inviteData (same fetch as effectiveQuota) — no /me race.
  // The server includes isAdmin: role === "admin" in every GET /api/invites/mine response.
  const isAdmin = inviteData?.isAdmin ?? false;

  const { data: quotaRequestData, refetch: refetchQuotaRequest } = useQuery({
    queryKey: ['my-quota-request'],
    queryFn:  () => customFetch<{ pendingRequest: { id: string } | null }>('/api/quota-requests/mine'),
  });
  const [quotaRequestSending,   setQuotaRequestSending]   = useState(false);
  const [quotaRequestConfirmed, setQuotaRequestConfirmed] = useState(false);

  // Admin badge — pending quota-request count, only fetched for admin users
  const { data: quotaCountData } = useQuery({
    queryKey: ['admin-quota-count'],
    queryFn:  () => customFetch<{ pending: number }>('/api/admin/quota-requests/count'),
    enabled:  isAdmin,
  });

  const handleRequestMoreInvites = useCallback(async () => {
    if (quotaRequestSending || quotaRequestData?.pendingRequest) return;
    setQuotaRequestSending(true);
    try {
      await customFetch('/api/quota-requests', { method: 'POST' });
      setQuotaRequestConfirmed(true);
      refetchQuotaRequest();
    } catch { /* silent */ } finally {
      setQuotaRequestSending(false);
    }
  }, [quotaRequestSending, quotaRequestData, refetchQuotaRequest]);

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

  /** Creates the invite (optionally with co-pet IDs), then shares the link. */
  const createAndShareInvite = useCallback(async (coPetIds: string[]) => {
    setCreatingInvite(true);
    try {
      const result = await customFetch<{ ok: boolean; invite: { id: string; code: string } }>(
        '/api/invites', { method: 'POST', body: JSON.stringify({ petIds: coPetIds }) },
      );
      const link    = `https://pshpsh.net/invite/${result.invite.code}`;
      const message = `you're invited to pshpsh — follow pets, not people. 🐾 ${link}`;
      if (Platform.OS === 'web') {
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
      setPetPickerVisible(false);
      setSelectedCoPetIds(new Set());
    }
  }, [refetchInvites]);

  /**
   * Tap handler for "invite a friend".
   * If the user owns ≥1 pet, open the co-ownership picker first.
   * Otherwise create the invite directly (zero-pet users have nothing to share).
   */
  const handleCallInFriend = useCallback(() => {
    if (creatingInvite) return;
    if (pets.length > 0) {
      setSelectedCoPetIds(new Set());
      setPetPickerVisible(true);
    } else {
      void createAndShareInvite([]);
    }
  }, [creatingInvite, pets.length, createAndShareInvite]);

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
  const remaining              = effectiveQuota - nonRevokedCount;
  const hasPendingQuotaRequest = Boolean(quotaRequestData?.pendingRequest);
  const quotaPendingCount      = quotaCountData?.pending ?? 0;
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
            <SocialLinks meData={meData!} colors={colors} />
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

        {/* Admin link — only visible to admins; badge shows pending quota requests */}
        {isAdmin && (
          <TouchableOpacity
            onPress={() => router.push('/admin')}
            activeOpacity={0.7}
            style={styles.editProfileRow}
            accessibilityRole="link"
            accessibilityLabel="Admin area"
          >
            <View style={styles.adminLinkRow}>
              <Text style={[styles.editProfileText, { color: colors.mutedForeground }]}>
                admin
              </Text>
              {quotaPendingCount > 0 && (
                <View style={[styles.adminBadge, { backgroundColor: colors.accent }]}>
                  <Text style={styles.adminBadgeText}>{quotaPendingCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}

        {/* ══════════════ MY PETS ══════════════ */}
        <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
        <Text style={[styles.heading, { color: colors.foreground }]}>My Pets</Text>

        {pets.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Heart size={32} color={colors.mutedForeground} weight="regular" style={{ marginBottom: 12 }} />
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

        {/* ══════════════ CO-OWNERSHIP REQUESTS ══════════════ */}
        {coOwnerRequests.length > 0 && (
          <>
            <View style={[styles.sectionDivider, { borderTopColor: colors.border }]} />
            <Text style={[styles.heading, { color: colors.foreground }]}>Co-ownership requests</Text>
            <View style={styles.listGap}>
              {coOwnerRequests.map((req) => (
                <View
                  key={req.id}
                  style={[styles.inviteCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.inviteCardText, { color: colors.foreground }]}>
                    {req.inviterUsername} wants to share {req.petName} with you.
                  </Text>
                  <View style={styles.inviteCardActions}>
                    <TouchableOpacity
                      onPress={() => handleCoOwnerDecline(req.id)}
                      disabled={coOwnerActingIds.has(req.id)}
                      style={[styles.inviteCardBtn, { borderColor: colors.border }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Decline co-ownership request for ${req.petName}`}
                    >
                      <Text style={[styles.inviteCardBtnText, { color: colors.mutedForeground }]}>decline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleCoOwnerAccept(req.id, req.petId)}
                      disabled={coOwnerActingIds.has(req.id)}
                      style={[styles.inviteCardBtn, { borderColor: colors.primary }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Accept co-ownership request for ${req.petName}`}
                    >
                      {coOwnerActingIds.has(req.id) ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Text style={[styles.inviteCardBtnText, { color: colors.primary }]}>accept</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => router.push(`/pet/${req.petId}`)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                    accessibilityRole="link"
                    accessibilityLabel={`View ${req.petName}'s profile`}
                  >
                    <Text style={[styles.inviteCardPetLink, { color: colors.mutedForeground }]}>
                      view {req.petName}'s profile →
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
            <Users size={28} color={colors.mutedForeground} weight="regular" style={{ marginBottom: 10 }} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing followed yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
              Follow pets, species, and breeds from their profiles.
            </Text>
          </View>
        ) : (
          <View style={styles.listGap}>

            {/* ── PETS I FOLLOW ── */}
            {packedPets.length > 0 && (
              <>
                <Text style={[styles.subheading, { color: colors.mutedForeground }]}>Pets I Follow</Text>
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

        {/* (a) COUNT — hero: remaining slots + hairline CTA
              Admins bypass quota entirely: show ∞ and always-on CTA.
              Non-admin behavior is byte-identical to before.              */}
        {(effectiveQuota > 0 || isAdmin) && (
          <>
            <Text style={[styles.inviteHeroText, { color: colors.foreground }]}>
              {isAdmin
                ? '∞ invites available'
                : remaining > 0
                  ? `${remaining} ${remaining === 1 ? 'invite' : 'invites'} available`
                  : 'all your friends are in'}
            </Text>
            {(isAdmin || remaining > 0) && (
              <>
                <Button
                  variant="primary"
                  label={creatingInvite ? undefined : 'invite a friend'}
                  onPress={handleCallInFriend}
                  disabled={creatingInvite}
                  style={{ alignSelf: 'flex-start', marginTop: 14, marginBottom: 4 }}
                >
                  {creatingInvite && <ActivityIndicator size={14} color={colors.foreground} />}
                </Button>
                <Text style={[styles.inviteHint, { color: colors.mutedForeground }]}>
                  each link is for one person and can only be used once.
                </Text>
              </>
            )}
            {/* Request more — non-admins only, when all quota is used up */}
            {!isAdmin && remaining === 0 && (
              <View style={{ marginTop: 12 }}>
                {(hasPendingQuotaRequest || quotaRequestConfirmed) ? (
                  <Text style={[styles.quietActionText, { color: colors.mutedForeground, opacity: 0.7 }]}>
                    {quotaRequestConfirmed ? "we'll take a look 🐾" : 'request pending'}
                  </Text>
                ) : (
                  <TouchableOpacity
                    onPress={handleRequestMoreInvites}
                    disabled={quotaRequestSending}
                    activeOpacity={0.7}
                    style={[styles.quietAction, { opacity: quotaRequestSending ? 0.4 : 1, paddingLeft: 0 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Request more invites"
                  >
                    {quotaRequestSending
                      ? <ActivityIndicator size={12} color={colors.mutedForeground} />
                      : <Text style={[styles.quietActionText, { color: colors.mutedForeground }]}>request more</Text>
                    }
                  </TouchableOpacity>
                )}
              </View>
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

        {/* Legal links — same whisper tier as send feedback */}
        {!confirmSignOut && (
          <View style={styles.legalRow}>
            <TouchableOpacity
              onPress={() => router.push('/terms')}
              activeOpacity={0.7}
              accessibilityRole="link"
              accessibilityLabel="Terms of Service"
            >
              <Text style={[styles.feedbackText, { color: colors.mutedForeground }]}>
                terms of service
              </Text>
            </TouchableOpacity>
            <Text style={[styles.legalDot, { color: colors.mutedForeground }]}> · </Text>
            <TouchableOpacity
              onPress={() => router.push('/privacy')}
              activeOpacity={0.7}
              accessibilityRole="link"
              accessibilityLabel="Privacy Policy"
            >
              <Text style={[styles.feedbackText, { color: colors.mutedForeground }]}>
                privacy policy
              </Text>
            </TouchableOpacity>
          </View>
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
            <SignOut size={16} color={colors.mutedForeground} weight="regular" />
            <Text style={[styles.signOutText, { color: colors.mutedForeground }]}>Sign out</Text>
          </TouchableOpacity>
        )}

      </ScrollView>

      {/* Feedback modal — portal visual system */}
      <FeedbackFlow
        visible={feedbackVisible}
        onClose={() => setFeedbackVisible(false)}
      />

      {/* ── Pet co-ownership picker ── */}
      <Modal
        visible={petPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!creatingInvite) setPetPickerVisible(false); }}
      >
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
              co-own any pets with this person?
            </Text>
            <Text style={[styles.pickerSub, { color: colors.mutedForeground }]}>
              optional — tap to select, then share the invite.
            </Text>
            {pets.map((pet) => {
              const selected = selectedCoPetIds.has(pet.id);
              return (
                <TouchableOpacity
                  key={pet.id}
                  onPress={() => {
                    setSelectedCoPetIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(pet.id)) next.delete(pet.id); else next.add(pet.id);
                      return next;
                    });
                  }}
                  activeOpacity={0.7}
                  style={[
                    styles.pickerRow,
                    {
                      borderColor:     selected ? colors.primary : colors.border,
                      backgroundColor: selected ? `${colors.primary}18` : colors.background,
                    },
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                >
                  <PetAvatar
                    url={pet.thumbnailUrl}
                    size={36}
                    backgroundColor={colors.secondary}
                    pawColor={colors.mutedForeground}
                  />
                  <Text style={[styles.pickerPetName, { color: colors.foreground }]} numberOfLines={1}>
                    {pet.name}
                  </Text>
                  {selected && (
                    <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>✓</Text>
                  )}
                </TouchableOpacity>
              );
            })}
            <View style={styles.pickerActions}>
              <Button
                variant="quiet"
                label="Skip"
                onPress={() => void createAndShareInvite([])}
                disabled={creatingInvite}
                style={{ flex: 1 }}
              />
              <Button
                variant="primary"
                label={creatingInvite ? undefined : selectedCoPetIds.size > 0 ? 'Continue' : 'Just invite'}
                onPress={() => void createAndShareInvite([...selectedCoPetIds])}
                disabled={creatingInvite}
                style={{ flex: 1 }}
              >
                {creatingInvite && <ActivityIndicator size={14} color={colors.foreground} />}
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// PetThumbnail extracted → shared components/PetAvatar.tsx

// ── PetRow ────────────────────────────────────────────────────────────────────

interface PetRowProps {
  pet:     Pet;
  colors:  ReturnType<typeof useColors>;
  onPress: () => void;
}

function PetRow({ pet, colors, onPress }: PetRowProps) {
  const subtitle = pet.breed ?? '';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`View ${pet.name}'s profile`}
      style={[styles.petRow, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <PetAvatar url={pet.thumbnailUrl} size={44} backgroundColor={colors.secondary} pawColor={colors.mutedForeground} />
      <View style={styles.petInfo}>
        <Text style={[styles.petName, { color: colors.foreground }]}>{pet.name}</Text>
        <Text style={[styles.petSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <CaretRight size={18} color={colors.mutedForeground} weight="regular" />
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
          <PetAvatar url={thumbnailUrl} size={40} backgroundColor={colors.secondary} pawColor={colors.mutedForeground} />
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
        <PawPrint size={24} weight="light" color={colors.mutedForeground} />
      </View>
    );
  }

  if (pets.length === 1) {
    return <PetAvatar url={pets[0].thumbnailUrl} size={40} backgroundColor={colors.secondary} pawColor={colors.mutedForeground} />;
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
          <PetAvatar url={pet.thumbnailUrl} size={CHIP} backgroundColor={colors.secondary} pawColor={colors.mutedForeground} />
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

// ── SocialLinks ───────────────────────────────────────────────────────────────

// FA5 Brands icon name for each platform.
// FA5 uses "twitter" (not "x-twitter" which is FA6).
const SOCIAL_DISPLAY: { key: keyof Pick<MeProfile, 'instagram'|'facebook'|'linkedin'|'xTwitter'|'tiktok'>; label: string; icon: string }[] = [
  { key: 'instagram', label: 'Instagram', icon: 'instagram' },
  { key: 'facebook',  label: 'Facebook',  icon: 'facebook'  },
  { key: 'linkedin',  label: 'LinkedIn',  icon: 'linkedin'  },
  { key: 'xTwitter',  label: 'X',         icon: 'twitter'   },
  { key: 'tiktok',    label: 'TikTok',    icon: 'tiktok'    },
];

function SocialLinks({
  meData,
  colors,
}: {
  meData: MeProfile;
  colors: ReturnType<typeof useColors>;
}) {
  const filled = SOCIAL_DISPLAY.filter(({ key }) => !!meData[key]);
  if (filled.length === 0) return null;

  return (
    <View style={styles.socialLinksRow}>
      {filled.map(({ key, label, icon }) => (
        <TouchableOpacity
          key={key}
          style={styles.socialLinkItem}
          activeOpacity={0.6}
          onPress={() => {
            const url = meData[key];
            if (url) Linking.openURL(url).catch(() => {});
          }}
          accessibilityRole="link"
          accessibilityLabel={label}
        >
          <FontAwesome5
            name={icon as React.ComponentProps<typeof FontAwesome5>['name']}
            size={18}
            color={colors.mutedForeground}
            brand
          />
        </TouchableOpacity>
      ))}
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
  inviteHint: {
    fontFamily: 'Inter_400Regular',
    fontSize:   12,
    lineHeight: 18,
    opacity:    0.55,
    marginTop:  6,
  },

  // Pet co-ownership picker modal
  pickerOverlay: {
    flex:             1,
    backgroundColor:  'rgba(0,0,0,0.55)',
    justifyContent:   'center',
    alignItems:       'center',
    padding:          24,
  },
  pickerSheet: {
    width:           '100%',
    maxWidth:        420,
    borderRadius:    20,
    borderWidth:     StyleSheet.hairlineWidth,
    padding:         24,
    gap:             12,
  },
  pickerTitle: {
    fontFamily:    'Inter_700Bold',
    fontSize:      17,
    letterSpacing: -0.2,
  },
  pickerSub: {
    fontFamily:   'Inter_400Regular',
    fontSize:     13,
    lineHeight:   19,
    marginBottom: 4,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
    borderWidth:   StyleSheet.hairlineWidth,
    borderRadius:  12,
    padding:       12,
  },
  pickerPetName: {
    fontFamily: 'Inter_500Medium',
    fontSize:   15,
    flex:       1,
  },
  pickerActions: {
    flexDirection: 'row',
    gap:           10,
    marginTop:     4,
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

  // Legal links — whisper tier, below send feedback
  legalRow: {
    flexDirection: 'row',
    alignItems:    'center',
    paddingVertical: 6,
    marginBottom:  8,
  },
  legalDot: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    opacity:    0.4,
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

  // Admin link badge
  adminLinkRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  adminBadge: {
    minWidth:          18,
    height:            18,
    borderRadius:      9,
    paddingHorizontal: 5,
    alignItems:        'center',
    justifyContent:    'center',
  },
  adminBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize:   11,
    color:      '#FFFFFF',
  },

  // Social links (appended below — keep in sync with SocialLinks component)
  socialLinksRow: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            12,
    marginTop:      8,
  },
  socialLinkItem: {
    paddingVertical: 0,
  },
  socialLinkText: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    textDecorationLine: 'underline',
  },
});
