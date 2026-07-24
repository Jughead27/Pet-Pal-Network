/**
 * Pet Profile — Finns's profile screen.
 *
 * Layout:
 *  - Hero image (top ~40% of screen)
 *  - Pet name, breed, bio
 *  - Add to Pack near the name
 *  - Boop + treat aggregate totals
 *  - Scrollable grid of posts
 */

import React, { useState } from "react";
import {
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
import { router } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import AddToPackLink from "@/components/AddToPackLink";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const HERO_HEIGHT = SCREEN_HEIGHT * 0.42;
const GRID_ITEM_SIZE = (SCREEN_WIDTH - 4) / 3; // 3 columns with 2px gaps

const PET_IMAGES = {
  hero: require("@/assets/images/ripley-hero.jpg"),
  post1: require("@/assets/images/ripley-post1.jpg"),
  post2: require("@/assets/images/ripley-post2.jpg"),
} as const;

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function PetProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { pet, boopCount, treatCount } = useApp();
  const [selectedPost, setSelectedPost] = useState<string | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const selectedPostData = selectedPost
    ? pet.posts.find((p) => p.id === selectedPost)
    : null;

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
            source={PET_IMAGES.hero}
            style={[styles.heroImage, { height: HERO_HEIGHT }]}
            resizeMode="cover"
          />
          <LinearGradient
            colors={["transparent", colors.background]}
            locations={[0.55, 1]}
            style={styles.heroGradient}
          />
          {/* Back button */}
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
            {pet.breed}
          </Text>

          <Text style={[styles.bio, { color: colors.foreground }]}>
            {pet.bio}
          </Text>

          {/* ── Stats ── */}
          <View style={[styles.statsRow, { borderColor: colors.border }]}>
            <View style={styles.stat}>
              <Feather
                name="heart"
                size={16}
                color={colors.accent}
                style={{ marginBottom: 4 }}
              />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {formatCount(boopCount)}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                Boops
              </Text>
            </View>
            <View
              style={[styles.statDivider, { backgroundColor: colors.border }]}
            />
            <View style={styles.stat}>
              <Feather
                name="star"
                size={16}
                color="#F4C542"
                style={{ marginBottom: 4 }}
              />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {formatCount(treatCount)}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                Treats
              </Text>
            </View>
            <View
              style={[styles.statDivider, { backgroundColor: colors.border }]}
            />
            <View style={styles.stat}>
              <Feather
                name="grid"
                size={16}
                color={colors.mutedForeground}
                style={{ marginBottom: 4 }}
              />
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {pet.posts.length}
              </Text>
              <Text
                style={[styles.statLabel, { color: colors.mutedForeground }]}
              >
                Posts
              </Text>
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
              onPress={() => setSelectedPost(post.id)}
              activeOpacity={0.85}
              style={styles.gridItem}
              accessibilityRole="button"
              accessibilityLabel={`View post: ${post.caption}`}
            >
              <Image
                source={PET_IMAGES[post.imageKey]}
                style={styles.gridImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* ── Post Detail Modal ── */}
      <Modal
        visible={!!selectedPost}
        animationType="fade"
        transparent
        onRequestClose={() => setSelectedPost(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSelectedPost(null)}
        >
          <View style={styles.modalContent}>
            {selectedPostData && (
              <>
                <Image
                  source={PET_IMAGES[selectedPostData.imageKey]}
                  style={styles.modalImage}
                  resizeMode="cover"
                />
                <View
                  style={[
                    styles.modalCaption,
                    { backgroundColor: colors.card },
                  ]}
                >
                  <Text
                    style={[styles.modalPetName, { color: colors.primary }]}
                  >
                    {pet.name}
                  </Text>
                  <Text
                    style={[
                      styles.modalCaptionText,
                      { color: colors.foreground },
                    ]}
                  >
                    {selectedPostData.caption}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.modalCloseBtn,
                    { backgroundColor: "rgba(6,11,16,0.7)" },
                  ]}
                  onPress={() => setSelectedPost(null)}
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
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  heroWrapper: {
    position: "relative",
  },
  heroImage: {
    width: "100%",
  },
  heroGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
  },
  backBtn: {
    position: "absolute",
    left: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  profileSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 6,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  petName: {
    fontSize: 26,
    fontWeight: "700" as const,
    letterSpacing: 0.2,
  },
  breed: {
    fontSize: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.3,
  },
  bio: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stat: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700" as const,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "500" as const,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 36,
  },
  gridDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
  },
  gridItem: {
    width: GRID_ITEM_SIZE,
    height: GRID_ITEM_SIZE,
  },
  gridImage: {
    width: "100%",
    height: "100%",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: SCREEN_WIDTH - 32,
    borderRadius: 16,
    overflow: "hidden",
  },
  modalImage: {
    width: "100%",
    height: SCREEN_WIDTH - 32,
  },
  modalCaption: {
    padding: 16,
    gap: 4,
  },
  modalPetName: {
    fontSize: 13,
    fontWeight: "600" as const,
    letterSpacing: 0.4,
  },
  modalCaptionText: {
    fontSize: 14,
    lineHeight: 20,
  },
  modalCloseBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
