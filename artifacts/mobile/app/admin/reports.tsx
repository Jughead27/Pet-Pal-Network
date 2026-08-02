/**
 * Reports triage — admin view of all pending content reports.
 *
 * Sort: animal_cruelty first, then oldest-first (server-side).
 * Actions per report:
 *   dismiss      — resolves the report; content untouched
 *   hide content — sets hidden_by_admin on the post/comment; resolves report
 *   suspend owner — suspends the content owner's account; resolves report
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowClockwise, ImageSquare, ChatCircle } from 'phosphor-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { customFetch } from '@workspace/api-client-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TargetPreviewPost {
  type:         'post';
  caption:      string | null;
  mediaUrl:     string | null;
  hiddenByAdmin: boolean;
}

interface TargetPreviewComment {
  type:         'comment';
  text:         string | null;
  hiddenByAdmin: boolean;
}

interface Report {
  id:               string;
  targetType:       'post' | 'comment';
  targetId:         string;
  reason:           string;
  note:             string | null;
  createdAt:        string;
  reporterUsername: string | null;
  targetPreview:    TargetPreviewPost | TargetPreviewComment;
  contentOwnerId:   string | null;
}

// ── Reason labels ─────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  not_animal_content: 'not animal content',
  animal_cruelty:     'animal cruelty ⚠️',
  mislabeled_pet:     'mislabeled pet',
  wrong_nursery_flag: 'wrong nursery flag',
  spam:               'spam',
  harassment:         'harassment',
  other:              'other',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminReportsScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const qc      = useQueryClient();

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const addPending    = (id: string) => setPendingIds((s) => new Set(s).add(id));
  const removePending = (id: string) => setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-reports'],
    queryFn:  () => customFetch<{ reports: Report[] }>('/api/admin/reports'),
  });

  const reports = data?.reports ?? [];

  const mutateReport = useCallback(async (reportId: string, action: 'dismiss' | 'hide' | 'suspend') => {
    if (pendingIds.has(reportId)) return;
    addPending(reportId);
    try {
      await customFetch(`/api/admin/reports/${reportId}/${action}`, { method: 'POST' });
      await refetch();
    } finally {
      removePending(reportId);
    }
  }, [pendingIds, refetch]);

  const renderReport = useCallback(({ item }: { item: Report }) => {
    const isPending = pendingIds.has(item.id);
    const preview   = item.targetPreview;
    const age       = formatAge(item.createdAt);

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Target preview */}
        <View style={styles.previewRow}>
          {preview.type === 'post' && preview.mediaUrl ? (
            <Image
              source={{ uri: preview.mediaUrl }}
              style={[styles.thumbnail, { borderColor: colors.border }]}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.thumbnailPlaceholder, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              {preview.type === 'post'
                ? <ImageSquare size={18} color={colors.mutedForeground} weight="regular" />
                : <ChatCircle size={18} color={colors.mutedForeground} weight="regular" />
              }
            </View>
          )}
          <View style={styles.previewMeta}>
            <Text style={[styles.reason, { color: item.reason === 'animal_cruelty' ? '#EF4444' : colors.foreground }]}>
              {REASON_LABELS[item.reason] ?? item.reason}
            </Text>
            {preview.type === 'post' && preview.caption ? (
              <Text numberOfLines={2} style={[styles.caption, { color: colors.mutedForeground }]}>
                {preview.caption}
              </Text>
            ) : preview.type === 'comment' && preview.text ? (
              <Text numberOfLines={2} style={[styles.caption, { color: colors.mutedForeground }]}>
                "{preview.text}"
              </Text>
            ) : null}
            {preview.hiddenByAdmin && (
              <Text style={[styles.badge, { color: colors.mutedForeground }]}>hidden</Text>
            )}
          </View>
        </View>

        {/* Meta */}
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            by {item.reporterUsername ?? 'unknown'} · {age}
          </Text>
          {item.note ? (
            <Text numberOfLines={1} style={[styles.meta, { color: colors.mutedForeground }]}>
              note: {item.note}
            </Text>
          ) : null}
        </View>

        {/* Actions */}
        {isPending ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} style={styles.spinner} />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => mutateReport(item.id, 'dismiss')}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Dismiss report"
            >
              <Text style={[styles.actionText, { color: colors.mutedForeground }]}>dismiss</Text>
            </TouchableOpacity>
            <Text style={[styles.actionSep, { color: colors.border }]}>·</Text>
            <TouchableOpacity
              onPress={() => mutateReport(item.id, 'hide')}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Hide content"
            >
              <Text style={[styles.actionText, { color: colors.foreground }]}>hide content</Text>
            </TouchableOpacity>
            <Text style={[styles.actionSep, { color: colors.border }]}>·</Text>
            <TouchableOpacity
              onPress={() => mutateReport(item.id, 'suspend')}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Suspend owner"
            >
              <Text style={[styles.actionText, { color: '#EF4444' }]}>suspend owner</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [colors, pendingIds, mutateReport]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.push('/admin')}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Reports</Text>
        <TouchableOpacity
          onPress={() => refetch()}
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
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Could not load reports.</Text>
        </View>
      ) : reports.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>No pending reports.</Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          renderItem={renderReport}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAge(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60)  return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:    { paddingHorizontal: 16, paddingTop: 12, gap: 12 },

  header: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingHorizontal: 16,
    paddingBottom:   12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  backBtn:     { padding: 6 },
  refreshBtn:  { padding: 6, marginLeft: 'auto' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, flex: 1 },
  spinner:     { paddingVertical: 12 },

  card: {
    borderRadius:  12,
    borderWidth:   StyleSheet.hairlineWidth,
    padding:       14,
    gap:           10,
  },

  previewRow: {
    flexDirection: 'row',
    gap:           12,
    alignItems:    'flex-start',
  },
  thumbnail: {
    width: 56, height: 56, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
  },
  thumbnailPlaceholder: {
    width: 56, height: 56, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  previewMeta: { flex: 1, gap: 4 },
  reason:      { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  caption:     { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  badge:       { fontFamily: 'Inter_400Regular', fontSize: 11, opacity: 0.6, fontStyle: 'italic' },

  metaRow: { gap: 2 },
  meta:    { fontFamily: 'Inter_400Regular', fontSize: 12 },

  actions: {
    flexDirection: 'row',
    alignItems:    'center',
    flexWrap:      'wrap',
    gap:           4,
    paddingTop:    4,
  },
  actionBtn:  { paddingVertical: 6, paddingHorizontal: 2 },
  actionText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  actionSep:  { fontSize: 13, paddingHorizontal: 2 },
});
