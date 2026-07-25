/**
 * Profile tab — shows the signed-in user's pets.
 *
 * Empty state  → "Create a pet" prompt + button
 * Has pets     → scrollable list (name + species/breed) + "Add another pet" button
 *
 * Tapping a pet navigates to /pet/[id].
 * Tapping create/add navigates to /pet/create.
 */

import React from 'react';
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
import { useColors } from '@/hooks/useColors';
import { useGetMyPets } from '@workspace/api-client-react';
import type { Pet } from '@workspace/api-client-react';

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const { data, isLoading, isError } = useGetMyPets();
  const pets = data?.pets ?? [];

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.background, paddingTop: topInset }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.background, paddingTop: topInset }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
          Could not load your pets.
        </Text>
      </View>
    );
  }

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
        {/* ── Header ── */}
        <Text style={[styles.heading, { color: colors.foreground }]}>My Pets</Text>

        {pets.length === 0 ? (
          /* ── Empty state ── */
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="heart" size={32} color={colors.mutedForeground} style={{ marginBottom: 12 }} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No pets yet
            </Text>
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
          /* ── Pet list ── */
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
              <Text style={[styles.addBtnText, { color: colors.foreground }]}>
                Add another pet
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── PetRow ───────────────────────────────────────────────────────────────────

interface PetRowProps {
  pet: Pet;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}

function PetRow({ pet, colors, onPress }: PetRowProps) {
  const subtitle = pet.breed
    ? `${pet.species} · ${pet.breed}`
    : pet.species;

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

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  scroll:  { flexGrow: 1, paddingHorizontal: 20 },

  heading: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    letterSpacing: -0.3,
    marginBottom: 20,
  },

  // Empty state
  emptyCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 32,
    alignItems: 'center',
    marginTop: 8,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },

  // Buttons
  primaryBtn: {
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 28,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 13,
    marginTop: 12,
  },
  addBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
  pressed: { opacity: 0.75 },

  // Pet row
  listGap: { gap: 8 },
  petRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  petAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  petInfo: { flex: 1, gap: 3 },
  petName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  petSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
});
