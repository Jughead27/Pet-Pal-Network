/**
 * Invite requests — admin list of all invite request submissions.
 * Actions: "mark contacted" / "close" (invite issuance deferred to Invites v2).
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
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { customFetch } from '@workspace/api-client-react';

interface InviteRequest {
  id:          string;
  email:       string;
  note:        string | null;
  requestedAt: string;
  status:      string;
}

const STATUS_LABEL: Record<string, string> = {
  pending:   'pending',
  contacted: 'contacted',
  closed:    'closed',
};

export default function AdminInvitesScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const addPending    = (id: string) => setPendingIds((s) => new Set(s).add(id));
  const removePending = (id: string) => setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-invites'],
    queryFn:  () => customFetch<{ inviteRequests: InviteRequest[] }>('/api/admin/invite-requests'),
  });

  const requests = data?.inviteRequests ?? [];

  const mutate = useCallback(async (id: string, action: 'contact' | 'close') => {
    if (pendingIds.has(id)) return;
    addPending(id);
    try {
      await customFetch(`/api/admin/invite-requests/${id}/${action}`, { method: 'POST' });
      await refetch();
    } finally {
      removePending(id);
    }
  }, [pendingIds, refetch]);

  const renderItem = useCallback(({ item }: { item: InviteRequest }) => {
    const isPending = pendingIds.has(item.id);
    const isActionable = item.status !== 'closed';
    const age = formatAge(item.requestedAt);

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardTop}>
          <Text style={[styles.email, { color: colors.foreground }]}>{item.email}</Text>
          <Text style={[styles.statusBadge, {
            color: item.status === 'pending' ? colors.mutedForeground :
                   item.status === 'contacted' ? colors.primary : colors.mutedForeground,
          }]}>
            {STATUS_LABEL[item.status] ?? item.status}
          </Text>
        </View>
        {item.note ? (
          <Text numberOfLines={3} style={[styles.note, { color: colors.mutedForeground }]}>
            {item.note}
          </Text>
        ) : null}
        <Text style={[styles.age, { color: colors.mutedForeground }]}>{age}</Text>

        {isPending ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : isActionable ? (
          <View style={styles.actions}>
            {item.status !== 'contacted' && (
              <>
                <TouchableOpacity
                  onPress={() => mutate(item.id, 'contact')}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Mark contacted"
                >
                  <Text style={[styles.actionText, { color: colors.foreground }]}>mark contacted</Text>
                </TouchableOpacity>
                <Text style={[styles.sep, { color: colors.border }]}>·</Text>
              </>
            )}
            <TouchableOpacity
              onPress={() => mutate(item.id, 'close')}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Close request"
            >
              <Text style={[styles.actionText, { color: colors.mutedForeground }]}>close</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  }, [colors, pendingIds, mutate]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button">
          <Feather name="arrow-left" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Invite Requests</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.refreshBtn} accessibilityRole="button">
          <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
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
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>No invite requests.</Text>
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
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  email:   { fontFamily: 'Inter_600SemiBold', fontSize: 14, flex: 1 },
  statusBadge: { fontFamily: 'Inter_400Regular', fontSize: 12, fontStyle: 'italic' },
  note:    { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  age:     { fontFamily: 'Inter_400Regular', fontSize: 11, opacity: 0.6 },

  actions:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 4 },
  actionBtn:  { paddingVertical: 4, paddingHorizontal: 2 },
  actionText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  sep:        { fontSize: 13, paddingHorizontal: 2 },
});
