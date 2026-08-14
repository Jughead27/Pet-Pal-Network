/**
 * Audit log — read-only chronological list of admin actions.
 * Boring-utility register: actor · action · target · age.
 * Paginated (20 per page) via load-more button; newest first.
 */

import React, { useState } from 'react';
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
import { formatAge } from '@/utils/formatAge';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id:            string;
  actorId:       string;
  actorUsername: string | null;
  action:        string;
  targetType:    string | null;
  targetId:      string | null;
  metadata:      Record<string, unknown> | null;
  createdAt:     string;
}

const PAGE_SIZE = 20;

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminLogScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const [page, setPage] = useState(0);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['admin-audit', page],
    queryFn:  () =>
      customFetch<{ entries: AuditEntry[]; total: number }>(
        `/api/admin/audit?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      ),
    placeholderData: (prev) => prev,
  });

  const entries = data?.entries ?? [];
  const total   = data?.total   ?? 0;
  const hasMore = (page + 1) * PAGE_SIZE < total;

  // ── Render row ─────────────────────────────────────────────────────────────

  const renderEntry = ({ item }: { item: AuditEntry }) => {
    const metaLine = buildMetaLine(item);
    return (
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={styles.rowMain}>
          <Text style={[styles.action, { color: colors.foreground }]}>
            {item.action}
          </Text>
          <Text style={[styles.actor, { color: colors.mutedForeground }]}>
            {item.actorUsername ?? item.actorId}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.age, { color: colors.mutedForeground }]}>
            {formatAge(item.createdAt)}
          </Text>
          {metaLine ? (
            <Text
              numberOfLines={1}
              style={[styles.meta, { color: colors.mutedForeground }]}
            >
              {metaLine}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  // ── Layout ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topInset + 8, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.push('/admin')}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Audit Log
        </Text>
        <TouchableOpacity
          onPress={() => { setPage(0); refetch(); }}
          style={styles.refreshBtn}
          accessibilityRole="button"
          accessibilityLabel="Refresh"
        >
          <ArrowClockwise size={16} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
            Could not load audit log.
          </Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
            No audit entries yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          renderItem={renderEntry}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={[styles.total, { color: colors.mutedForeground }]}>
              {total} action{total !== 1 ? 's' : ''} total · page {page + 1}
            </Text>
          }
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity
                onPress={() => setPage((p) => p + 1)}
                style={[styles.loadMore, { borderColor: colors.border }]}
                accessibilityRole="button"
              >
                {isFetching ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <Text style={[styles.loadMoreText, { color: colors.mutedForeground }]}>
                    load older
                  </Text>
                )}
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** One-line summary of the most useful metadata fields for this action. */
function buildMetaLine(e: AuditEntry): string | null {
  const m = e.metadata;
  if (!m) return e.targetId ? `→ ${String(e.targetId).slice(0, 8)}` : null;

  const parts: string[] = [];
  if (typeof m.reason      === 'string') parts.push(m.reason);
  if (typeof m.breedName   === 'string') parts.push(m.breedName);
  if (typeof m.speciesName === 'string') parts.push(m.speciesName);
  if (typeof m.petsUpdated === 'number') parts.push(`${m.petsUpdated} pets`);
  if (typeof m.reportId    === 'string') parts.push(`report ${String(m.reportId).slice(0, 8)}`);
  if (parts.length === 0 && e.targetId) parts.push(`→ ${String(e.targetId).slice(0, 8)}`);
  return parts.join(' · ') || null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:    { paddingHorizontal: 0, paddingTop: 0 },

  header: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: 16,
    paddingBottom:    12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  backBtn:     { padding: 6 },
  refreshBtn:  { padding: 6, marginLeft: 'auto' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, flex: 1 },

  total: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  row: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    paddingHorizontal: 16,
    paddingVertical:   12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  rowMain: { flex: 1, gap: 2 },
  rowRight: { alignItems: 'flex-end', gap: 2, minWidth: 70 },

  action: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  actor:  { fontFamily: 'Inter_400Regular', fontSize: 12 },
  age:    { fontFamily: 'Inter_400Regular', fontSize: 12 },
  meta:   { fontFamily: 'Inter_400Regular', fontSize: 11, maxWidth: 120 },

  loadMore: {
    margin: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  loadMoreText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
