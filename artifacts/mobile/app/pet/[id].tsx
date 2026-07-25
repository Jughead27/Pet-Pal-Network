/**
 * Pet Profile — pet's profile screen.
 *
 * Data comes from GET /pets/:id via useGetPet(id).
 * Boop/treat aggregate totals are summed across all posts from the server.
 * Images are resolved via resolveMediaKey() (seed: keys → bundled assets).
 */

import React, { useState } from "react";
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
import { useColors } from "@/hooks/useColors";
import { useGetPet } from "@workspace/api-client-react";
import { resolveMediaKey } from "@/utils/mediaKey";
import type { FeedPost } from "@workspace/api-client-react";
import AddToPackLink from "@/components/AddToPackLink";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const HERO_HEIGHT = SCREEN_HEIGHT * 0.42;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 4) / 3;

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function PetProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id: rawId } = useLocalSearchParams();
  const petId = Array.isArray(rawId) ? rawId[0] : rawId;

  const { data: pet, isLoading, isError } = useGetPet(petId ?? "");

  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  // ── Loading / error states ─────────────────────────────────────────────
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
  const totalBoops   = pet.posts.reduce((s, p) => s + p.boopCount, 0);
  const totalTreats  = pet.posts.reduce((s, p) => s + p.treatCount, 0);

  // Hero image: first post's media key (most recent)
  const heroSource = pet.posts.length > 0
    ? resolveMediaKey(pet.posts[0].mediaKey, pet.posts[0].mediaUrl)
    : resolveMediaKey("seed:hero");

  const selectedPost: FeedPost | undefined =
    pet.posts.find((p) => p.id === selectedPostId);

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
            <AddToPackLink />
          </View>

          <Text style={[styles.breed, { color: colors.mutedForeground }]}>
            {pet.breed ?? pet.species}
          </Text>

          {pet.bio ? (
            <Text style={[styles.bio, { color: colors.foreground }]}>
              {pet.bio}
            </Text>
          ) : null}

          {/* ── Stats ── */}
          <View style={[styles.statsRow, { borderColor: colors.border }]}>
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
                  resizeMode="cover"
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
  centered: { alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  heroWrapper: { position: "relative" },
  heroImage: { width: "100%" },
  heroGradient: {
    position: "absolute", left: 0, right: 0, bottom: 0, height: 120,
  },
  backBtn: {
    position: "absolute", left: 14, width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },
  profileSection: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  petName: { fontSize: 26, fontWeight: "700" as const, letterSpacing: 0.2 },
  breed: { fontSize: 14, fontWeight: "500" as const, letterSpacing: 0.3 },
  bio: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  statsRow: {
    flexDirection: "row", alignItems: "center", marginTop: 16,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "700" as const },
  statLabel: {
    fontSize: 11, fontWeight: "500" as const, letterSpacing: 0.5,
    textTransform: "uppercase", marginTop: 2,
  },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36 },
  gridDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2 },
  gridItem: { width: GRID_ITEM_SIZE, height: GRID_ITEM_SIZE },
  gridImage: { width: "100%", height: "100%" },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center", alignItems: "center",
  },
  modalContent: { width: SCREEN_WIDTH - 32, borderRadius: 16, overflow: "hidden" },
  modalImage: { width: "100%", height: SCREEN_WIDTH - 32 },
  modalCaption: { padding: 16, gap: 4 },
  modalPetName: { fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.4 },
  modalCaptionText: { fontSize: 14, lineHeight: 20 },
  modalCloseBtn: {
    position: "absolute", top: 12, right: 12,
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
});
