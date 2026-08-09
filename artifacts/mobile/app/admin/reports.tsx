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
import { ArrowLeft, ArrowClockwise, ImageSquare, ChatCircle, User } from 'phosphor-react-native';
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

interface TargetPreviewUser {
  type:        'user';
  username:    string | null;
  displayName: string | null;
  suspended:   boolean;
}

interface Report {
  id:               string;
  targetType:       'post' | 'comment' | 'user';
  targetId:         string;
  reason:           string;
  note:             string | null;
  createdAt:        string;
  reporterUsername: string | null;
  targetPreview:    TargetPreviewPost | TargetPreviewComment | TargetPreviewUser;
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

  // Suspended users — read-only list + unsuspend trigger (endpoint pre-existing)
  const { data: suspendedData, refetch: refetchSuspended } = useQuery({
    queryKey: ['admin-suspended-users'],
    queryFn:  () => customFetch<{ users: { id: string; username: string | null; displayName: string | null }[] }>('/api/admin/suspended-users'),
  });
  const suspendedUsers = suspendedData?.users ?? [];
  const [unsuspendingIds, setUnsuspendingIds] = useState<Set<string>>(new Set());

  const handleUnsuspend = useCallback(async (targetUserId: string) => {
    setUnsuspendingIds((s) => new Set(s).add(targetUserId));
    try {
      await customFetch(`/api/admin/users/${targetUserId}/unsuspend`, { method: 'POST' });
      await refetchSuspended();
    } finally {
      setUnsuspendingIds((s) => { const n = new Set(s); n.delete(targetUserId); return n; });
    }
  }, [refetchSuspended]);

  const mutateReport = useCallback(async (reportId: string, action: 'dismiss' | 'hide' | 'suspend') => {
    if (pendingIds.has(reportId)) return;
    addPending(reportId);
    try {
      await customFetch(`/api/admin/reports/${reportId}/${action}`, { method: 'POST' });
      await refetch();
      if (action === 'suspend') await refetchSuspended();
    } finally {
      removePending(reportId);
    }
  }, [pendingIds, refetch, refetchSuspended]);

  // ── Admin account deletion (enforcement) ─────────────────────────────────
  // Two-tap flow: "delete account" arms the confirm, second tap executes.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const handleDeleteAccount = useCallback(async (reportId: string, targetUserId: string) => {
    if (pendingIds.has(reportId)) return;
    setPendingIds((s) => new Set(s).add(reportId));
    setConfirmingDeleteId(null);
    try {
      await customFetch(`/api/admin/users/${targetUserId}/delete`, { method: 'POST' });
      // Resolve the report view — deletion tombstones the user; the report
      // itself is preserved server-side, so just refresh the queue.
      await refetch();
      await refetchSuspended();
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(reportId); return n; });
    }
  }, [pendingIds, refetch, refetchSuspended]);

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
                : preview.type === 'comment'
                  ? <ChatCircle size={18} color={colors.mutedForeground} weight="regular" />
                  : <User size={18} color={colors.mutedForeground} weight="regular" />
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
            ) : preview.type === 'user' ? (
              <Text numberOfLines={1} style={[styles.caption, { color: colors.mutedForeground }]}>
                member: {preview.displayName?.trim() || preview.username || 'a pshpsh member'}
              </Text>
            ) : null}
            {preview.type !== 'user' && preview.hiddenByAdmin && (
              <Text style={[styles.badge, { color: colors.mutedForeground }]}>hidden</Text>
            )}
            {preview.type === 'user' && preview.suspended && (
              <Text style={[styles.badge, { color: colors.mutedForeground }]}>suspended</Text>
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
            {/* "hide" only applies to content targets — user reports have nothing to hide */}
            {item.targetType !== 'user' && (
              <>
                <Text style={[styles.actionSep, { color: colors.border }]}>·</Text>
                <TouchableOpacity
                  onPress={() => mutateReport(item.id, 'hide')}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Hide content"
                >
                  <Text style={[styles.actionText, { color: colors.foreground }]}>hide content</Text>
                </TouchableOpacity>
              </>
            )}
            <Text style={[styles.actionSep, { color: colors.border }]}>·</Text>
            <TouchableOpacity
              onPress={() => mutateReport(item.id, 'suspend')}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Suspend owner"
            >
              <Text style={[styles.actionText, { color: '#EF4444' }]}>suspend owner</Text>
            </TouchableOpacity>
            {/* Account deletion — enforcement path; needs a resolvable owner */}
            {item.contentOwnerId && (
              <>
                <Text style={[styles.actionSep, { color: colors.border }]}>·</Text>
                {confirmingDeleteId === item.id ? (
                  <>
                    <TouchableOpacity
                      onPress={() => handleDeleteAccount(item.id, item.contentOwnerId!)}
                      style={styles.actionBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Confirm delete account"
                    >
                      <Text style={[styles.actionText, { color: '#EF4444' }]}>confirm delete?</Text>
                    </TouchableOpacity>
                    <Text style={[styles.actionSep, { color: colors.border }]}>·</Text>
                    <TouchableOpacity
                      onPress={() => setConfirmingDeleteId(null)}
                      style={styles.actionBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel delete account"
                    >
                      <Text style={[styles.actionText, { color: colors.mutedForeground }]}>cancel</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    onPress={() => setConfirmingDeleteId(item.id)}
                    style={styles.actionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Delete account"
                  >
                    <Text style={[styles.actionText, { color: '#EF4444' }]}>delete account</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}
      </View>
    );
  }, [colors, pendingIds, mutateReport, confirmingDeleteId, handleDeleteAccount]);

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
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          renderItem={renderReport}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
              No pending reports.
            </Text>
          }
          ListFooterComponent={
            suspendedUsers.length > 0 ? (
              <View style={styles.suspendedSection}>
                <Text style={[styles.suspendedHeading, { color: colors.mutedForeground }]}>
                  Suspended users
                </Text>
                {suspendedUsers.map((u) => (
                  <View
                    key={u.id}
                    style={[styles.suspendedRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <Text style={[styles.suspendedName, { color: colors.foreground }]} numberOfLines={1}>
                      {u.displayName?.trim() || u.username || 'a pshpsh member'}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleUnsuspend(u.id)}
                      disabled={unsuspendingIds.has(u.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Unsuspend ${u.displayName?.trim() || u.username || 'user'}`}
                      style={[styles.unsuspendBtn, { borderColor: colors.border, opacity: unsuspendingIds.has(u.id) ? 0.4 : 1 }]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.unsuspendText, { color: colors.foreground }]}>unsuspend</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null
          }
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

  suspendedSection: {
    marginTop: 20,
    gap: 8,
  },
  suspendedHeading: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  suspendedRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    borderWidth:    StyleSheet.hairlineWidth,
    borderRadius:   10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 12,
  },
  suspendedName: {
    fontFamily: 'Inter_500Medium',
    fontSize:   14,
    flex: 1,
  },
  unsuspendBtn: {
    borderWidth:  1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  unsuspendText: {
    fontFamily: 'Inter_500Medium',
    fontSize:   13,
  },

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
