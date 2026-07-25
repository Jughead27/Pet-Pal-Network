/**
 * Pet Profile — pet's profile screen.
 *
 * Data comes from GET /pets/:id via useGetPet(id).
 * Displays packCount + viewerInPack (server-backed via AddToPackLink).
 * Species/breed chips are tappable follows (server-backed via InterestChip).
 * Boop/treat aggregate totals are summed across all posts from the server.
 */

import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import {
  useGetPet,
  useGetPetPackMembers,
  useFollowSpecies,
  useUnfollowSpecies,
  useFollowBreed,
  useUnfollowBreed,
} from "@workspace/api-client-react";
import type { FeedPost, PackResult } from "@workspace/api-client-react";
import { resolveMediaKey } from "@/utils/mediaKey";
import AddToPackLink from "@/components/AddToPackLink";
import InterestChip from "@/components/InterestChip";
import { useFollowsContext } from "@/context/FollowsContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const HERO_HEIGHT = SCREEN_HEIGHT * 0.42;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 4) / 3;

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Filled paw icon for the Pack stat cell. */
function PawStatIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <Path d="M7.2 7.24a1.9 1.9 0 0 0-1.9 2.4c.19.98 1.04 1.7 2.09 1.52A2.19 2.19 0 0 0 9.1 9.4a1.9 1.9 0 0 0-1.9-2.16zm9.6 0a1.9 1.9 0 0 0-1.9 2.16 2.19 2.19 0 0 0 1.71 1.76c1.05.18 1.9-.54 2.09-1.52a1.9 1.9 0 0 0-1.9-2.4zM10 4.1a1.8 1.8 0 0 0-1.8 2.3 2.11 2.11 0 0 0 1.64 1.7c1.02.17 1.83-.52 1.96-1.5A1.8 1.8 0 0 0 10 4.1zm4 0a1.8 1.8 0 0 0-1.8 2.5c.13.98.94 1.67 1.96 1.5A2.11 2.11 0 0 0 15.8 6.4 1.8 1.8 0 0 0 14 4.1zM12 11c-2.6 0-4.9 2-4.9 4.3 0 1.6 1.2 2.7 2.8 2.7 1 0 1.5-.4 2.1-.4s1.1.4 2.1.4c1.6 0 2.8-1.1 2.8-2.7C16.9 13 14.6 11 12 11Z" />
    </Svg>
  );
}

export default function PetProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id: rawId } = useLocalSearchParams();
  const petId = Array.isArray(rawId) ? rawId[0] : rawId;

  const { data: pet, isLoading, isError } = useGetPet(petId ?? "");

  const [selectedPostId,  setSelectedPostId]  = useState<string | null>(null);
  const [packMembersOpen, setPackMembersOpen] = useState(false);
  // Local pack count — initialised from server, updated optimistically on toggle
  const [localPackCount, setLocalPackCount] = useState<number | null>(null);

  // Pack members — fetched when component mounts; React Query caches the result
  const { data: membersData, isLoading: membersLoading } = useGetPetPackMembers(petId ?? "");

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  // ── Interest follows ───────────────────────────────────────────────────────
  const { speciesMap, breedMap, setSpeciesFollow, setBreedFollow } = useFollowsContext();

  // Mutation pending guards — disable chips while in-flight to prevent double-tap
  const speciesPendingRef = useRef(false);
  const breedPendingRef   = useRef(false);
  const [speciesPending, setSpeciesPending] = useState(false);
  const [breedPending,   setBreedPending]   = useState(false);

  const { mutate: followSpecies }   = useFollowSpecies();
  const { mutate: unfollowSpecies } = useUnfollowSpecies();
  const { mutate: followBreed }     = useFollowBreed();
  const { mutate: unfollowBreed }   = useUnfollowBreed();

  const handleFollowSpecies = useCallback(() => {
    if (!pet?.speciesId || speciesPendingRef.current) return;
    speciesPendingRef.current = true;
    setSpeciesPending(true);

    const id        = pet.speciesId;
    const wasFollow = speciesMap[id] ?? pet.viewerFollowsSpecies ?? false;
    const nextFollow = !wasFollow;

    setSpeciesFollow(id, nextFollow);

    const mutate = nextFollow ? followSpecies : unfollowSpecies;
    mutate(
      { id },
      {
        onSuccess: (result) => {
          setSpeciesFollow(id, result.viewerFollows);
          speciesPendingRef.current = false;
          setSpeciesPending(false);
        },
        onError: () => {
          setSpeciesFollow(id, wasFollow);
          speciesPendingRef.current = false;
          setSpeciesPending(false);
        },
      },
    );
  }, [pet, speciesMap, setSpeciesFollow, followSpecies, unfollowSpecies]);

  const handleFollowBreed = useCallback(() => {
    if (!pet?.breedId || breedPendingRef.current) return;
    breedPendingRef.current = true;
    setBreedPending(true);

    const id        = pet.breedId;
    const wasFollow = breedMap[id] ?? pet.viewerFollowsBreed ?? false;
    const nextFollow = !wasFollow;

    setBreedFollow(id, nextFollow);

    const mutate = nextFollow ? followBreed : unfollowBreed;
    mutate(
      { id },
      {
        onSuccess: (result) => {
          setBreedFollow(id, result.viewerFollows);
          breedPendingRef.current = false;
          setBreedPending(false);
        },
        onError: () => {
          setBreedFollow(id, wasFollow);
          breedPendingRef.current = false;
          setBreedPending(false);
        },
      },
    );
  }, [pet, breedMap, setBreedFollow, followBreed, unfollowBreed]);

  // ── Loading / error states ─────────────────────────────────────────────────
  if (isLoading || (!pet && !isError)) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (isError || !pet) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
          Could not load profile.
        </Text>
      </View>
    );
  }

  // Aggregate reaction totals across all posts
  const totalBoops  = pet.posts.reduce((s, p) => s + p.boopCount,  0);
  const totalTreats = pet.posts.reduce((s, p) => s + p.treatCount, 0);
  const packCount   = localPackCount ?? pet.packCount;

  // Hero image: first post's media key (most recent)
  const heroSource = pet.posts.length > 0
    ? resolveMediaKey(pet.posts[0].mediaKey, pet.posts[0].mediaUrl)
    : resolveMediaKey("seed:hero");

  const selectedPost: FeedPost | undefined = pet.posts.find((p) => p.id === selectedPostId);

  const handlePackSuccess = (result: PackResult) => {
    setLocalPackCount(result.packCount);
  };

  // Derive current follow state (context wins over server initial value)
  const speciesFollowed = pet.speciesId
    ? (speciesMap[pet.speciesId] ?? pet.viewerFollowsSpecies ?? false)
    : null;
  const breedFollowed = pet.breedId
    ? (breedMap[pet.breedId] ?? pet.viewerFollowsBreed ?? false)
    : null;

  // Show legacy plain text if pet has no catalogue FKs
  const hasChips = pet.speciesId != null || pet.breedId != null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 84 : 100),
        }}
      >
        {/* ── Hero ── */}
        <View style={styles.heroWrapper}>
          <Image
            source={heroSource}
            style={[styles.heroImage, { height: HERO_HEIGHT }]}
            resizeMode="cover"
          />
          <LinearGradient
            colors={["transparent", colors.background]}
            locations={[0.55, 1]}
            style={styles.heroGradient}
          />
          <TouchableOpacity
            onPress={() => router.back()}
            style={[
              styles.backBtn,
              { top: topInset + 8, backgroundColor: "rgba(6,11,16,0.5)" },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color="#F0F4F8" />
          </TouchableOpacity>
        </View>

        {/* ── Profile Info ── */}
        <View style={styles.profileSection}>
          <View style={styles.nameRow}>
            <Text style={[styles.petName, { color: colors.foreground }]}>
              {pet.name}
            </Text>
            <AddToPackLink
              petId={pet.id}
              initialInPack={pet.viewerInPack}
              onSuccess={handlePackSuccess}
            />
          </View>

          {/* Species / breed — chips if catalogued, plain text for legacy pets */}
          {hasChips ? (
            <View style={styles.chipsRow}>
              {pet.speciesId != null && speciesFollowed != null && (
                <InterestChip
                  label={pet.species}
                  followed={speciesFollowed}
                  onPress={handleFollowSpecies}
                  disabled={speciesPending}
                />
              )}
              {pet.breedId != null && breedFollowed != null && pet.breed && (
                <InterestChip
                  label={pet.breed}
                  followed={breedFollowed}
                  onPress={handleFollowBreed}
                  disabled={breedPending}
                />
              )}
            </View>
          ) : (
            <Text style={[styles.breed, { color: colors.mutedForeground }]}>
              {pet.breed ?? pet.species}
            </Text>
          )}

          {pet.bio ? (
            <Text style={[styles.bio, { color: colors.foreground }]}>
              {pet.bio}
            </Text>
          ) : null}

          {/* ── Stats ── */}
          <View style={[styles.statsRow, { borderColor: colors.border }]}>
            {/* Pack stat — tappable to view member list */}
            <TouchableOpacity
              onPress={() => setPackMembersOpen(true)}
              activeOpacity={0.7}
              style={styles.stat}
              accessibilityRole="button"
              accessibilityLabel={`Pack — ${packCount} members`}
            >
              <PawStatIcon size={16} color={colors.primary} />
              <Text style={[styles.statValue, { color: colors.foreground, marginTop: 4 }]}>
                {formatCount(packCount)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Pack</Text>
            </TouchableOpacity>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <Feather name="heart" size={16} color={colors.accent} style={{ marginBottom: 4 }} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {formatCount(totalBoops)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Boops</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <Feather name="star" size={16} color="#F4C542" style={{ marginBottom: 4 }} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {formatCount(totalTreats)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Treats</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.stat}>
              <Feather name="grid" size={16} color={colors.mutedForeground} style={{ marginBottom: 4 }} />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {pet.posts.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Posts</Text>
            </View>
          </View>
        </View>

        {/* ── Grid Divider ── */}
        <View style={[styles.gridDivider, { borderTopColor: colors.border }]} />

        {/* ── Post Grid ── */}
        <View style={styles.grid}>
          {pet.posts.map((post) => (
            <TouchableOpacity
              key={post.id}
              onPress={() => setSelectedPostId(post.id)}
              activeOpacity={0.85}
              style={styles.gridItem}
              accessibilityRole="button"
              accessibilityLabel={`View post: ${post.caption ?? ""}`}
            >
              <Image
                source={resolveMediaKey(post.mediaKey, post.mediaUrl)}
                style={styles.gridImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* ── Pack Members Modal ── */}
      <Modal
        visible={packMembersOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPackMembersOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setPackMembersOpen(false)}
          />
          <View style={[styles.membersSheet, { backgroundColor: colors.card }]}>
            {/* Header */}
            <View style={[styles.membersHeader, { borderBottomColor: colors.border }]}>
              <PawStatIcon size={14} color={colors.primary} />
              <Text style={[styles.membersTitle, { color: colors.foreground }]}>
                Pack · {formatCount(packCount)}
              </Text>
              <TouchableOpacity
                onPress={() => setPackMembersOpen(false)}
                style={styles.membersCloseBtn}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {/* Content */}
            {membersLoading ? (
              <View style={styles.membersCentered}>
                <ActivityIndicator color={colors.primary} size="small" />
              </View>
            ) : !membersData || membersData.members.length === 0 ? (
              <View style={styles.membersCentered}>
                <Text style={[styles.membersEmpty, { color: colors.mutedForeground }]}>
                  No pack members yet.
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.membersList}
                contentContainerStyle={styles.membersListContent}
                showsVerticalScrollIndicator={false}
              >
                {membersData.members.map((m) => (
                  <View
                    key={m.username}
                    style={[styles.memberRow, { borderBottomColor: colors.border }]}
                  >
                    <Text style={[styles.memberUsername, { color: colors.foreground }]}>
                      {m.username}
                    </Text>
                    <Text style={[styles.memberDate, { color: colors.mutedForeground }]}>
                      {new Date(m.joinedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day:   "numeric",
                        year:  "numeric",
                      })}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Post Detail Modal ── */}
      <Modal
        visible={!!selectedPostId}
        animationType="fade"
        transparent
        onRequestClose={() => setSelectedPostId(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedPostId(null)}>
          <View style={styles.modalContent}>
            {selectedPost && (
              <>
                <Image
                  source={resolveMediaKey(selectedPost.mediaKey, selectedPost.mediaUrl)}
                  style={styles.modalImage}
                  resizeMode="contain"
                />
                <View style={[styles.modalCaption, { backgroundColor: colors.card }]}>
                  <Text style={[styles.modalPetName, { color: colors.primary }]}>
                    {pet.name}
                  </Text>
                  <Text style={[styles.modalCaptionText, { color: colors.foreground }]}>
                    {selectedPost.caption ?? ""}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.modalCloseBtn, { backgroundColor: "rgba(6,11,16,0.7)" }]}
                  onPress={() => setSelectedPostId(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={20} color="#F0F4F8" />
                </TouchableOpacity>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered:  { alignItems: "center", justifyContent: "center" },
  scroll:    { flex: 1 },
  heroWrapper:  { position: "relative" },
  heroImage:    { width: "100%" },
  heroGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: 120 },
  backBtn: {
    position: "absolute", left: 14, width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },
  profileSection: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 8 },
  nameRow:  { flexDirection: "row", alignItems: "center", gap: 12 },
  petName:  { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  breed:    { fontSize: 14, fontFamily: "Inter_500Medium", letterSpacing: 0.3 },
  bio:      { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  statsRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat:       { flex: 1, alignItems: "center" },
  statValue:  { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel:  {
    fontSize: 11, fontFamily: "Inter_500Medium", letterSpacing: 0.5,
    textTransform: "uppercase", marginTop: 2,
  },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36 },
  gridDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  grid:        { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  gridItem:    { width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE },
  gridImage:   { width: "100%", height: "100%" },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end", alignItems: "center",
  },

  // Pack members sheet (slides up from bottom)
  membersSheet: {
    width: "100%",
    maxHeight: "60%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  membersHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  membersTitle: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    letterSpacing: -0.2,
  },
  membersCloseBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  membersCentered: {
    paddingVertical: 40,
    alignItems: "center",
  },
  membersEmpty: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
  membersList: { flex: 1 },
  membersListContent: { paddingBottom: 40 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberUsername: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  memberDate: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },

  // Post detail modal
  modalContent:     { width: SCREEN_WIDTH - 32, borderRadius: 16, overflow: "hidden" },
  modalImage:       { width: "100%", height: SCREEN_WIDTH - 32 },
  modalCaption:     { padding: 16, gap: 4 },
  modalPetName:     { fontSize: 13, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
  modalCaptionText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  modalCloseBtn: {
    position: "absolute", top: 12, right: 12,
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
});
