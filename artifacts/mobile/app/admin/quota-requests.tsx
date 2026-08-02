/**
 * Quota Requests — admin list of members requesting more invite slots.
 * Separate from the pre-signup invite_requests (email capture) queue.
 * Actions: "grant" (+5 quota bump) / "dismiss" (no quota change).
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

interface QuotaRequest {
  id:          string;
  userId:      string;
  status:      string;
  createdAt:   string;
  resolvedAt:  string | null;
  username:    string | null;
  displayName: string | null;
}

export default function AdminQuotaRequestsScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const addPending    = (id: string) => setPendingIds((s) => new Set(s).add(id));
  const removePending = (id: string) => setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-quota-requests'],
    queryFn:  () => customFetch<{ requests: QuotaRequest[] }>('/api/admin/quota-requests'),
  });

  const requests = (data?.requests ?? []).filter((r) => r.status === 'pending');

  const mutate = useCallback(async (id: string, action: 'grant' | 'dismiss') => {
    if (pendingIds.has(id)) return;
    addPending(id);
    try {
      await customFetch(`/api/admin/quota-requests/${id}/${action}`, { method: 'POST' });
      await refetch();
    } finally {
      removePending(id);
    }
  }, [pendingIds, refetch]);

  const renderItem = useCallback(({ item }: { item: QuotaRequest }) => {
    const isPending = pendingIds.has(item.id);
    const age = formatAge(item.createdAt);
    const name = item.displayName ?? item.username ?? item.userId.slice(0, 8);

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardTop}>
          <Text style={[styles.name, { color: colors.foreground }]}>{name}</Text>
          {item.username && item.displayName && (
            <Text style={[styles.handle, { color: colors.mutedForeground }]}>@{item.username}</Text>
          )}
        </View>
        <Text style={[styles.age, { color: colors.mutedForeground }]}>{age}</Text>

        {isPending ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => mutate(item.id, 'grant')}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Grant invite quota"
            >
              <Text style={[styles.actionGrant, { color: colors.primary }]}>grant</Text>
            </TouchableOpacity>
            <Text style={[styles.sep, { color: colors.border }]}>·</Text>
            <TouchableOpacity
              onPress={() => mutate(item.id, 'dismiss')}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Dismiss request"
            >
              <Text style={[styles.actionText, { color: colors.mutedForeground }]}>dismiss</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [colors, pendingIds, mutate]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button">
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Quota Requests</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.refreshBtn} accessibilityRole="button">
          <ArrowClockwise size={16} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Could not load requests.</Text>
        </View>
      ) : requests.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>No pending quota requests.</Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function formatAge(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60)  return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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
    padding: 14, gap: 6,
  },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  name:   { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  handle: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  age:     { fontFamily: 'Inter_400Regular', fontSize: 11, opacity: 0.6 },

  actions:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 4 },
  actionBtn:  { paddingVertical: 4, paddingHorizontal: 2 },
  actionGrant: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  actionText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  sep:        { fontSize: 13, paddingHorizontal: 2 },
});
