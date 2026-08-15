/**
 * Users — read-only admin table of all live (non-tombstoned) members.
 * Columns: Display Name | Invited By | Invites (used/quota) | Posts.
 * Purely informational — actions live in Invite Management.
 * Sorted most-recently-joined first (server-side).
 */

import React from 'react';
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

interface UsersSummary {
  totalUsers:           number;
  totalInvites:         number;
  totalInvitesAccepted: number;
  totalPosts:           number;
}

interface UserOverviewRow {
  id:             string;
  displayName:    string | null;
  role:           string;
  createdAt:      string;
  invitedByName:  string | null;
  effectiveQuota: number;
  invitesUsed:    number;
  postCount:      number;
}

export default function AdminUsersScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-users-overview'],
    queryFn:  () => customFetch<{ users: UserOverviewRow[]; summary?: UsersSummary }>('/api/admin/users-overview'),
  });

  const users   = data?.users ?? [];
  const summary = data?.summary;

  const renderItem = ({ item }: { item: UserOverviewRow }) => (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text numberOfLines={1} style={[styles.cellName, { color: colors.foreground }]}>
        {item.displayName ?? '—'}
      </Text>
      <Text numberOfLines={1} style={[styles.cellInviter, { color: colors.mutedForeground }]}>
        {item.invitedByName ?? '—'}
      </Text>
      <Text style={[styles.cellInvites, { color: colors.mutedForeground }]}>
        {item.role === 'admin' ? `${item.invitesUsed}/∞` : `${item.invitesUsed}/${item.effectiveQuota}`}
      </Text>
      <Text style={[styles.cellPosts, { color: colors.mutedForeground }]}>
        {formatCount(item.postCount)}
      </Text>
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.push('/admin')}
          style={styles.backBtn}
          accessibilityRole="button"
        >
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Users</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.refreshBtn} accessibilityRole="button">
          <ArrowClockwise size={16} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Could not load users.</Text>
          <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 12 }}>
            <Text style={{ color: colors.primary, fontFamily: 'Inter_500Medium', fontSize: 14 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={renderItem}
          ListHeaderComponent={
            <>
              {summary && (
                <Text style={[styles.summaryStrip, { color: colors.mutedForeground }]}>
                  {formatCount(summary.totalUsers)} users · {formatCount(summary.totalInvitesAccepted)}/{formatCount(summary.totalInvites)} invites accepted · {formatCount(summary.totalPosts)} posts
                </Text>
              )}
              <View style={[styles.row, styles.headRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.cellName, styles.headText, { color: colors.mutedForeground }]}>name</Text>
              <Text style={[styles.cellInviter, styles.headText, { color: colors.mutedForeground }]}>invited by</Text>
              <Text style={[styles.cellInvites, styles.headText, { color: colors.mutedForeground }]}>invites</Text>
              <Text style={[styles.cellPosts, styles.headText, { color: colors.mutedForeground }]}>posts</Text>
              </View>
            </>
          }
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill:     { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:     { paddingHorizontal: 16, paddingTop: 4 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  backBtn:     { padding: 6 },
  refreshBtn:  { padding: 6, marginLeft: 'auto' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, flex: 1 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headRow:  { paddingVertical: 8 },
  summaryStrip: { fontFamily: 'Inter_400Regular', fontSize: 13, paddingTop: 10, paddingBottom: 6 },
  headText: { fontFamily: 'Inter_500Medium', fontSize: 11, textTransform: 'lowercase' },

  cellName:    { flex: 2.2, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  cellInviter: { flex: 1.8, fontFamily: 'Inter_400Regular', fontSize: 13 },
  cellInvites: { flex: 1,   fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'right' },
  cellPosts:   { flex: 0.7, fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'right' },
});
