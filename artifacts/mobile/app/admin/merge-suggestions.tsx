/**
 * Merge suggestions — admin queue of user-submitted "same pet" suggestions.
 * Shows both pets side by side (suggester pet/owner vs target pet/owner).
 * Actions: dismiss / mark merged (actioned). The actual merge itself is
 * performed via the merge tooling — this queue only resolves the entry.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowClockwise } from 'phosphor-react-native';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { customFetch } from '@workspace/api-client-react';

interface Suggestion {
  id: string;
  createdAt: string;
  suggesterUserId: string;
  suggesterUsername: string | null;
  suggesterPetId: string;
  suggesterPetName: string;
  suggesterPetSpecies: string;
  suggesterPetBreed: string | null;
  targetPetId: string;
  targetPetName: string;
  targetPetSpecies: string;
  targetPetBreed: string | null;
  targetOwnerId: string;
  targetOwnerUsername: string | null;
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export default function AdminMergeSuggestionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // Two-tap confirm for the actioned ("mark merged") action — only one
  // suggestion can be in confirm mode at a time (reports.tsx pattern).
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-merge-suggestions'],
    queryFn: () => customFetch<{ suggestions: Suggestion[] }>('/api/admin/merge-suggestions'),
  });

  const suggestions = data?.suggestions ?? [];

  const mutate = useCallback(async (id: string, action: 'dismiss' | 'action') => {
    if (pendingIds.has(id)) return;
    setPendingIds((s) => new Set(s).add(id));
    setConfirmingActionId(null);
    try {
      await customFetch(`/api/admin/merge-suggestions/${id}/${action}`, { method: 'POST' });
      await refetch();
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [pendingIds, refetch]);

  const petLine = (name: string, species: string, breed: string | null) =>
    `${name} · ${breed?.trim() || species}`;

  const renderItem = useCallback(({ item }: { item: Suggestion }) => {
    const isPending = pendingIds.has(item.id);
    const confirming = confirmingActionId === item.id;

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Side-by-side pets */}
        <View style={styles.pairRow}>
          <TouchableOpacity
            style={styles.petCol}
            onPress={() => router.push(`/pet/${item.suggesterPetId}`)}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.suggesterPetName}`}
          >
            <Text style={[styles.colLabel, { color: colors.mutedForeground }]}>suggester's pet</Text>
            <Text style={[styles.petName, { color: colors.foreground }]}>
              {petLine(item.suggesterPetName, item.suggesterPetSpecies, item.suggesterPetBreed)}
            </Text>
            <Text style={[styles.ownerName, { color: colors.mutedForeground }]}>
              @{item.suggesterUsername ?? 'unknown'}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.pairSep, { color: colors.mutedForeground }]}>=?</Text>
          <TouchableOpacity
            style={styles.petCol}
            onPress={() => router.push(`/pet/${item.targetPetId}`)}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.targetPetName}`}
          >
            <Text style={[styles.colLabel, { color: colors.mutedForeground }]}>target pet</Text>
            <Text style={[styles.petName, { color: colors.foreground }]}>
              {petLine(item.targetPetName, item.targetPetSpecies, item.targetPetBreed)}
            </Text>
            <Text style={[styles.ownerName, { color: colors.mutedForeground }]}>
              @{item.targetOwnerUsername ?? 'unknown'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.age, { color: colors.mutedForeground }]}>
          submitted {relativeAge(item.createdAt)}
        </Text>

        {isPending ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <View style={styles.actions}>
            {confirming ? (
              <>
                <TouchableOpacity
                  onPress={() => mutate(item.id, 'action')}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm mark merged"
                >
                  <Text style={[styles.actionText, { color: colors.destructive }]}>confirm merged?</Text>
                </TouchableOpacity>
                <Text style={[styles.sep, { color: colors.border }]}>·</Text>
                <TouchableOpacity
                  onPress={() => setConfirmingActionId(null)}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={[styles.actionText, { color: colors.mutedForeground }]}>cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => setConfirmingActionId(item.id)}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Mark merged"
                >
                  <Text style={[styles.actionText, { color: colors.foreground }]}>mark merged</Text>
                </TouchableOpacity>
                <Text style={[styles.sep, { color: colors.border }]}>·</Text>
                <TouchableOpacity
                  onPress={() => mutate(item.id, 'dismiss')}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss suggestion"
                >
                  <Text style={[styles.actionText, { color: colors.mutedForeground }]}>dismiss</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
    );
  }, [colors, pendingIds, confirmingActionId, mutate]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.push('/admin')} style={styles.backBtn} accessibilityRole="button">
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Merge Suggestions</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.refreshBtn} accessibilityRole="button">
          <ArrowClockwise size={16} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Could not load suggestions.</Text>
        </View>
      ) : suggestions.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>No merge suggestions pending.</Text>
        </View>
      ) : (
        <FlatList
          data={suggestions}
          keyExtractor={(s) => s.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  backBtn: { padding: 6 },
  refreshBtn: { padding: 6, marginLeft: 'auto' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, flex: 1 },

  card: {
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    padding: 14, gap: 10,
  },
  pairRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  petCol: { flex: 1, gap: 2 },
  pairSep: { fontFamily: 'Inter_400Regular', fontSize: 13, paddingTop: 18 },
  colLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  petName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  ownerName: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  age: { fontFamily: 'Inter_400Regular', fontSize: 11, fontStyle: 'italic' },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBtn: { paddingVertical: 4, paddingHorizontal: 2 },
  actionText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  sep: { fontSize: 13, paddingHorizontal: 2 },
});
