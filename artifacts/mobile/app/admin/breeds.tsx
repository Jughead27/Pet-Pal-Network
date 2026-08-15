/**
 * Breed suggestions — admin view of "Not listed" free-text breed submissions.
 * Actions: approve (creates breed in taxonomy, remaps pets) / reject (clears breed text).
 * Duplicate-aware: approving a name that already exists ci-matches to existing breed.
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
import { formatCount } from '@/utils/formatCount';
import { customFetch } from '@workspace/api-client-react';

interface Suggestion {
  speciesId:   string;
  speciesName: string;
  breedName:   string;
  petCount:    number;
}

export default function AdminBreedsScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  // Track pending by composite key "speciesId|breedName"
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const key = (s: Suggestion) => `${s.speciesId}|${s.breedName}`;
  const addPending    = (k: string) => setPendingKeys((s) => new Set(s).add(k));
  const removePending = (k: string) => setPendingKeys((s) => { const n = new Set(s); n.delete(k); return n; });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-breeds'],
    queryFn:  () => customFetch<{ suggestions: Suggestion[] }>('/api/admin/breed-suggestions'),
  });

  const suggestions = data?.suggestions ?? [];

  const mutate = useCallback(async (item: Suggestion, action: 'approve' | 'reject') => {
    const k = key(item);
    if (pendingKeys.has(k)) return;
    addPending(k);
    try {
      await customFetch(`/api/admin/breed-suggestions/${action}`, {
        method: 'POST',
        body:   JSON.stringify({ speciesId: item.speciesId, breedName: item.breedName }),
      });
      await refetch();
    } finally {
      removePending(k);
    }
  }, [pendingKeys, refetch]);

  const renderItem = useCallback(({ item }: { item: Suggestion }) => {
    const k          = key(item);
    const isPending  = pendingKeys.has(k);

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardTop}>
          <View style={styles.labelCol}>
            <Text style={[styles.breedName,   { color: colors.foreground }]}>{item.breedName}</Text>
            <Text style={[styles.speciesName,  { color: colors.mutedForeground }]}>{item.speciesName}</Text>
          </View>
          <Text style={[styles.count, { color: colors.mutedForeground }]}>
            {formatCount(item.petCount)} {item.petCount === 1 ? 'pet' : 'pets'}
          </Text>
        </View>

        {isPending ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => mutate(item, 'approve')}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel={`Approve ${item.breedName}`}
            >
              <Text style={[styles.actionText, { color: colors.foreground }]}>approve</Text>
            </TouchableOpacity>
            <Text style={[styles.sep, { color: colors.border }]}>·</Text>
            <TouchableOpacity
              onPress={() => mutate(item, 'reject')}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel={`Reject ${item.breedName}`}
            >
              <Text style={[styles.actionText, { color: colors.mutedForeground }]}>reject</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [colors, pendingKeys, mutate]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.push('/admin')} style={styles.backBtn} accessibilityRole="button">
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Breed Suggestions</Text>
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
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>No breed suggestions pending.</Text>
        </View>
      ) : (
        <FlatList
          data={suggestions}
          keyExtractor={(s) => `${s.speciesId}|${s.breedName}`}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:    { paddingHorizontal: 16, paddingTop: 12, gap: 12 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  backBtn:     { padding: 6 },
  refreshBtn:  { padding: 6, marginLeft: 'auto' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, flex: 1 },

  card: {
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    padding: 14, gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  labelCol: { gap: 2, flex: 1 },
  breedName:   { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  speciesName: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  count:       { fontFamily: 'Inter_400Regular', fontSize: 12, fontStyle: 'italic' },

  actions:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBtn:  { paddingVertical: 4, paddingHorizontal: 2 },
  actionText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  sep:        { fontSize: 13, paddingHorizontal: 2 },
});
