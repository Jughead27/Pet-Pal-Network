/**
 * Admin feedback inbox.
 *
 * Lists all feedback submissions newest-first.
 * Each row shows: body (clamped), username, age, status.
 * "mark reviewed" quiet action per new row.
 *
 * Paginated with a "load more" button (20/page).
 */

import React, { useState, useCallback } from 'react';
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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'phosphor-react-native';
import { useColors } from '@/hooks/useColors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { formatAge } from '@/utils/formatAge';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeedbackEntry {
  id:           string;
  userId:       string;
  username:     string | null;
  body:         string;
  status:       'new' | 'reviewed';
  createdAt:    string;
}

interface FeedbackPage {
  entries: FeedbackEntry[];
  total:   number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAGE = 20;

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AdminFeedbackScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const qc       = useQueryClient();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const [offset, setOffset] = useState(0);
  const [allEntries, setAllEntries] = useState<FeedbackEntry[]>([]);
  const [total, setTotal]           = useState<number | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  // ── Fetch page ──────────────────────────────────────────────────────────────
  const { isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-feedback', offset],
    queryFn:  async () => {
      const data = await customFetch<FeedbackPage>(
        `/api/admin/feedback?limit=${PAGE}&offset=${offset}`,
      );
      if (offset === 0) {
        setAllEntries(data.entries);
      } else {
        setAllEntries((prev) => [...prev, ...data.entries]);
      }
      setTotal(data.total);
      return data;
    },
  });

  // ── Mark reviewed mutation ──────────────────────────────────────────────────
  const { mutate: markReviewed } = useMutation({
    mutationFn: (id: string) =>
      customFetch<{ ok: boolean }>(`/api/admin/feedback/${id}/reviewed`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });
      // Optimistic UI: flip status in local list
      setAllEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status: 'reviewed' as const } : e)),
      );
      qc.invalidateQueries({ queryKey: ['admin-feedback'] });
    },
    onError: (_err, id) => {
      setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    },
  });

  const handleMarkReviewed = useCallback((id: string) => {
    if (pendingIds.has(id)) return;
    setPendingIds((s) => new Set(s).add(id));
    markReviewed(id);
  }, [pendingIds, markReviewed]);

  const handleLoadMore = useCallback(() => {
    setOffset((o) => o + PAGE);
  }, []);

  const handleRefresh = useCallback(() => {
    setOffset(0);
    setAllEntries([]);
    setTotal(null);
    refetch();
  }, [refetch]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topInset + 16, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.push('/admin')}
          style={styles.backRow}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
          <Text style={[styles.backText, { color: colors.mutedForeground }]}>back</Text>
        </TouchableOpacity>

        <Text style={[styles.heading, { color: colors.foreground }]}>Feedback</Text>
        {total !== null && (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {total} submission{total !== 1 ? 's' : ''}
          </Text>
        )}

        <View style={[styles.divider, { borderTopColor: colors.border }]} />

        {/* Loading state (initial only) */}
        {isLoading && allEntries.length === 0 && (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        )}

        {/* Error state */}
        {isError && allEntries.length === 0 && (
          <View style={styles.centered}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Could not load feedback.
            </Text>
            <TouchableOpacity onPress={handleRefresh} style={{ marginTop: 12 }}>
              <Text style={{ color: colors.primary, fontFamily: 'Inter_500Medium', fontSize: 14 }}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Empty state */}
        {!isLoading && allEntries.length === 0 && !isError && (
          <View style={styles.centered}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No feedback yet.
            </Text>
          </View>
        )}

        {/* List */}
        {allEntries.map((entry) => (
          <FeedbackRow
            key={entry.id}
            entry={entry}
            colors={colors}
            isPending={pendingIds.has(entry.id)}
            onMarkReviewed={() => handleMarkReviewed(entry.id)}
          />
        ))}

        {/* Load more */}
        {total !== null && allEntries.length < total && (
          <Pressable
            onPress={handleLoadMore}
            style={({ pressed }) => [
              styles.loadMore,
              { borderColor: colors.border, backgroundColor: colors.card },
              pressed && { opacity: 0.65 },
            ]}
          >
            <Text style={[styles.loadMoreText, { color: colors.mutedForeground }]}>
              load more
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

// ── FeedbackRow ───────────────────────────────────────────────────────────────

interface FeedbackRowProps {
  entry:           FeedbackEntry;
  colors:          ReturnType<typeof useColors>;
  isPending:       boolean;
  onMarkReviewed:  () => void;
}

function FeedbackRow({ entry, colors, isPending, onMarkReviewed }: FeedbackRowProps) {
  const isNew = entry.status === 'new';

  return (
    <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {/* Body — clamped to 4 lines */}
      <Text
        style={[styles.body, { color: colors.foreground }]}
        numberOfLines={4}
      >
        {entry.body}
      </Text>

      {/* Meta row */}
      <View style={styles.meta}>
        <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
          {entry.username ?? 'unknown'} · {formatAge(entry.createdAt)}
          {!isNew && '  ·  reviewed'}
        </Text>

        {/* Mark reviewed — only shown for new entries */}
        {isNew && (
          <TouchableOpacity
            onPress={onMarkReviewed}
            disabled={isPending}
            style={[styles.quietAction, isPending && { opacity: 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel="Mark reviewed"
          >
            {isPending ? (
              <ActivityIndicator size={12} color={colors.mutedForeground} />
            ) : (
              <Text style={[styles.quietActionText, { color: colors.mutedForeground }]}>
                mark reviewed
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:   { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 20 },

  backRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    marginBottom:  24,
  },
  backText: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  heading: {
    fontFamily:    'Inter_700Bold',
    fontSize:      28,
    letterSpacing: -0.4,
    marginBottom:  4,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize:   14,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 24,
  },

  centered: {
    alignItems:      'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize:   15,
  },

  // Feedback entry card
  row: {
    borderWidth:   StyleSheet.hairlineWidth,
    borderRadius:  12,
    padding:       14,
    marginBottom:  10,
    gap:           10,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize:   14,
    lineHeight: 20,
  },
  meta: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    gap:             8,
  },
  metaText: {
    fontFamily: 'Inter_400Regular',
    fontSize:   12,
    flex:       1,
  },

  // Quiet typographic action
  quietAction: {
    minHeight:         36,
    paddingHorizontal: 8,
    paddingVertical:   4,
    alignItems:        'center',
    justifyContent:    'center',
    flexShrink:        0,
  },
  quietActionText: {
    fontFamily:    'Inter_500Medium',
    fontSize:      12,
    letterSpacing: 0.1,
  },

  // Load more
  loadMore: {
    borderWidth:     StyleSheet.hairlineWidth,
    borderRadius:    10,
    paddingVertical: 13,
    alignItems:      'center',
    marginTop:       8,
  },
  loadMoreText: {
    fontFamily: 'Inter_500Medium',
    fontSize:   14,
  },
});
