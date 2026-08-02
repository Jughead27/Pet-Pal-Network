/**
 * Admin: Invite Management
 *
 * Per-user effective quota (COALESCE(user override, config default))
 * with a quiet "set quota" action — updates users.invite_quota in a
 * transaction + audit ('user.invite_quota_set', old/new in metadata).
 *
 * Also shows invited_by lineage (who called each user in).
 */

import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'phosphor-react-native';
import { useColors } from '@/hooks/useColors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserQuotaRow {
  id:                string;
  username:          string | null;
  inviteQuota:       number | null;
  effectiveQuota:    number;
  invitedByUsername: string | null;
  nonRevokedCount:   number;
  activeCount:       number;
  usedCount:         number;
}

interface ManagementData {
  defaultQuota: number;
  users:        UserQuotaRow[];
  total:        number;
}

const PAGE = 30;

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AdminInviteManagementScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const qc       = useQueryClient();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const [offset, setOffset]   = useState(0);
  const [allRows, setAllRows] = useState<UserQuotaRow[]>([]);
  const [total, setTotal]     = useState<number | null>(null);
  const [defaultQuota, setDefaultQuota] = useState(5);

  // Which row's quota input is open
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [quotaInput, setQuotaInput]   = useState('');
  const [savingId, setSavingId]       = useState<string | null>(null);

  const { isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-invite-management', offset],
    queryFn: async () => {
      const data = await customFetch<ManagementData>(
        `/api/admin/invite-management?limit=${PAGE}&offset=${offset}`,
      );
      if (offset === 0) {
        setAllRows(data.users);
      } else {
        setAllRows((prev) => [...prev, ...data.users]);
      }
      setTotal(data.total);
      setDefaultQuota(data.defaultQuota);
      return data;
    },
  });

  const handleSetQuota = useCallback(async (userId: string) => {
    const raw   = quotaInput.trim();
    const quota = raw === '' ? null : parseInt(raw, 10);
    if (raw !== '' && (isNaN(quota as number) || (quota as number) < 0)) return;

    setSavingId(userId);
    try {
      await customFetch<{ ok: boolean }>('/api/admin/invite-management/quota', {
        method: 'POST',
        body:   JSON.stringify({ userId, quota }),
      });
      setEditingId(null);
      setQuotaInput('');
      // Optimistic update
      setAllRows((prev) =>
        prev.map((r) =>
          r.id === userId
            ? { ...r, inviteQuota: quota, effectiveQuota: quota ?? defaultQuota }
            : r,
        ),
      );
      qc.invalidateQueries({ queryKey: ['admin-invite-management'] });
    } catch { /* silent */ } finally {
      setSavingId(null);
    }
  }, [quotaInput, defaultQuota, qc]);

  const handleLoadMore = useCallback(() => setOffset((o) => o + PAGE), []);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topInset + 16, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back */}
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.push('/admin')}
          style={styles.backRow}
          accessibilityRole="button"
        >
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
          <Text style={[styles.backText, { color: colors.mutedForeground }]}>back</Text>
        </TouchableOpacity>

        <Text style={[styles.heading, { color: colors.foreground }]}>Invite Management</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          default quota: {defaultQuota} · {total !== null ? `${total} members` : ''}
        </Text>

        <View style={[styles.divider, { borderTopColor: colors.border }]} />

        {/* Loading */}
        {isLoading && allRows.length === 0 && (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
        )}

        {/* Error */}
        {isError && allRows.length === 0 && (
          <View style={styles.centered}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Could not load data.
            </Text>
            <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 12 }}>
              <Text style={{ color: colors.primary, fontFamily: 'Inter_500Medium', fontSize: 14 }}>
                Retry
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Rows */}
        {allRows.map((row) => (
          <UserRow
            key={row.id}
            row={row}
            defaultQuota={defaultQuota}
            colors={colors}
            isEditing={editingId === row.id}
            isSaving={savingId === row.id}
            quotaInput={quotaInput}
            onStartEdit={() => {
              setEditingId(row.id);
              setQuotaInput(row.inviteQuota !== null ? String(row.inviteQuota) : '');
            }}
            onCancelEdit={() => { setEditingId(null); setQuotaInput(''); }}
            onQuotaChange={setQuotaInput}
            onSave={() => handleSetQuota(row.id)}
          />
        ))}

        {/* Load more */}
        {total !== null && allRows.length < total && (
          <TouchableOpacity
            onPress={handleLoadMore}
            style={[styles.loadMore, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Text style={[styles.loadMoreText, { color: colors.mutedForeground }]}>
              load more
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

// ── UserRow ───────────────────────────────────────────────────────────────────

interface UserRowProps {
  row:           UserQuotaRow;
  defaultQuota:  number;
  colors:        ReturnType<typeof useColors>;
  isEditing:     boolean;
  isSaving:      boolean;
  quotaInput:    string;
  onStartEdit:   () => void;
  onCancelEdit:  () => void;
  onQuotaChange: (v: string) => void;
  onSave:        () => void;
}

function UserRow({
  row, defaultQuota, colors, isEditing, isSaving,
  quotaInput, onStartEdit, onCancelEdit, onQuotaChange, onSave,
}: UserRowProps) {
  const hasOverride = row.inviteQuota !== null;

  return (
    <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
      {/* Identity */}
      <View style={styles.rowTop}>
        <View style={styles.rowInfo}>
          <Text style={[styles.username, { color: colors.foreground }]}>
            {row.username ?? row.id}
          </Text>
          {row.invitedByUsername ? (
            <Text style={[styles.lineage, { color: colors.mutedForeground }]}>
              called in by {row.invitedByUsername}
            </Text>
          ) : (
            <Text style={[styles.lineage, { color: colors.mutedForeground }]}>
              founding account
            </Text>
          )}
        </View>
        {/* Quota badge */}
        <Text style={[styles.quotaBadge, { color: hasOverride ? colors.foreground : colors.mutedForeground }]}>
          {row.effectiveQuota}{hasOverride ? '' : ' (default)'}
        </Text>
      </View>

      {/* Stats */}
      <Text style={[styles.stats, { color: colors.mutedForeground }]}>
        {row.usedCount} joined · {row.activeCount} pending · {row.nonRevokedCount}/{row.effectiveQuota} used
      </Text>

      {/* Quota editor */}
      {isEditing ? (
        <View style={styles.editRow}>
          <TextInput
            value={quotaInput}
            onChangeText={onQuotaChange}
            placeholder={String(defaultQuota)}
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            style={[styles.quotaInput, { color: colors.foreground, borderColor: colors.border }]}
            autoFocus
            maxLength={4}
          />
          <Text style={[styles.editHint, { color: colors.mutedForeground }]}>
            (blank = reset to default)
          </Text>
          {isSaving ? (
            <ActivityIndicator size={14} color={colors.mutedForeground} />
          ) : (
            <>
              <TouchableOpacity onPress={onSave} style={styles.editAction}>
                <Text style={[styles.editActionText, { color: colors.foreground }]}>save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onCancelEdit} style={styles.editAction}>
                <Text style={[styles.editActionText, { color: colors.mutedForeground }]}>cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <TouchableOpacity
          onPress={onStartEdit}
          style={styles.setQuotaBtn}
          accessibilityRole="button"
          accessibilityLabel="Set quota"
        >
          <Text style={[styles.setQuotaText, { color: colors.mutedForeground }]}>
            set quota
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  scroll:  { flexGrow: 1, paddingHorizontal: 20 },
  centered: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 15 },

  backRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 24 },
  backText: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  heading:  { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.4, marginBottom: 4 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  divider:  { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 24 },

  row: {
    borderWidth:   StyleSheet.hairlineWidth,
    borderRadius:  12,
    padding:       14,
    marginBottom:  10,
    gap:           6,
  },
  rowTop: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            8,
  },
  rowInfo:    { flex: 1, gap: 2 },
  username:   { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  lineage:    { fontFamily: 'Inter_400Regular', fontSize: 12, opacity: 0.7 },
  quotaBadge: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  stats:      { fontFamily: 'Inter_400Regular', fontSize: 12, opacity: 0.6 },

  // Quota editor
  editRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    marginTop:     4,
    flexWrap:      'wrap',
  },
  quotaInput: {
    borderWidth:       1,
    borderRadius:      8,
    paddingHorizontal: 10,
    paddingVertical:   6,
    fontSize:          15,
    fontFamily:        'Inter_400Regular',
    width:             64,
  },
  editHint: {
    fontFamily: 'Inter_400Regular',
    fontSize:   11,
    flex:       1,
    opacity:    0.6,
  },
  editAction: {
    paddingHorizontal: 6,
    paddingVertical:   4,
  },
  editActionText: {
    fontFamily: 'Inter_500Medium',
    fontSize:   13,
  },

  // Set quota whisper
  setQuotaBtn: {
    alignSelf:       'flex-start',
    paddingVertical: 4,
    marginTop:       2,
  },
  setQuotaText: {
    fontFamily: 'Inter_400Regular',
    fontSize:   12,
    opacity:    0.65,
  },

  loadMore: {
    borderWidth:     StyleSheet.hairlineWidth,
    borderRadius:    10,
    paddingVertical: 13,
    alignItems:      'center',
    marginTop:       8,
  },
  loadMoreText: { fontFamily: 'Inter_500Medium', fontSize: 14 },
});
