/**
 * Admin hub — boring-utility navigation to moderation surfaces.
 * Fetches the pending quota-request count to show a badge on that item.
 */

import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, CaretRight } from 'phosphor-react-native';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { customFetch } from '@workspace/api-client-react';

const SECTIONS = [
  {
    route:       '/admin/reports' as const,
    label:       'Reports',
    description: 'Pending content reports — dismiss, hide, or suspend.',
  },
  {
    route:       '/admin/invites' as const,
    label:       'Invite Requests',
    description: 'Mark contacted or close invite request submissions.',
  },
  {
    route:       '/admin/quota-requests' as const,
    label:       'Quota Requests',
    description: 'Approve or dismiss members requesting more invite slots.',
  },
  {
    route:       '/admin/breeds' as const,
    label:       'Breed Suggestions',
    description: 'Approve or reject "Not listed" free-text breed submissions.',
  },
  {
    route:       '/admin/log' as const,
    label:       'Audit Log',
    description: 'Chronological record of every admin action. Read-only.',
  },
  {
    route:       '/admin/feedback' as const,
    label:       'Feedback',
    description: 'Member feedback submissions — mark reviewed when actioned.',
  },
  {
    route:       '/admin/spotlight' as const,
    label:       'Spotlight',
    description: 'Featured pet on Sniff — pin a pet or manage the auto window.',
  },
  {
    route:       '/admin/invite-management' as const,
    label:       'Invite Management',
    description: 'Per-user quota overrides and invited-by lineage.',
  },
  {
    route:       '/admin/users' as const,
    label:       'Users',
    description: 'Read-only member table — lineage, invite usage, post counts.',
  },
];

export default function AdminIndexScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  // Pending quota-request count for the badge on the Quota Requests row
  const { data: quotaCountData } = useQuery({
    queryKey: ['admin-quota-count'],
    queryFn:  () => customFetch<{ pending: number }>('/api/admin/quota-requests/count'),
  });
  const quotaPendingCount = quotaCountData?.pending ?? 0;

  // Health-check totals — quiet row above the section list; never blocks it.
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn:  () =>
      customFetch<{ users: number; posts: number; comments: number; treats: number; boops: number }>(
        '/api/admin/stats',
      ),
  });

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
          onPress={() => router.push('/(tabs)/profile')}
          style={styles.backRow}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
          <Text style={[styles.backText, { color: colors.mutedForeground }]}>back</Text>
        </TouchableOpacity>

        <Text style={[styles.heading, { color: colors.foreground }]}>admin</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          moderation & operations
        </Text>

        <View style={[styles.divider, { borderTopColor: colors.border }]} />

        {/* Stats row — quiet health-check totals, above the reports section */}
        <View style={styles.statsRow}>
          {([
            ['users',    stats?.users],
            ['posts',    stats?.posts],
            ['comments', stats?.comments],
            ['treats',   stats?.treats],
            ['boops',    stats?.boops],
          ] as const).map(([label, value]) => (
            <View key={label} style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {value ?? '–'}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
            </View>
          ))}
        </View>

        {SECTIONS.map(({ route, label, description }) => {
          const pendingCount = route === '/admin/quota-requests' ? quotaPendingCount : 0;
          return (
            <TouchableOpacity
              key={route}
              onPress={() => router.push(route)}
              activeOpacity={0.7}
              style={[styles.row, { borderBottomColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <View style={styles.rowContent}>
                <View style={styles.rowLabelRow}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
                  {pendingCount > 0 && (
                    <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                      <Text style={styles.badgeText}>{pendingCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.rowDesc, { color: colors.mutedForeground }]}>{description}</Text>
              </View>
              <CaretRight size={16} color={colors.mutedForeground} weight="regular" />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

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

  statsRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginBottom:   24,
  },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: {
    fontFamily:    'Inter_700Bold',
    fontSize:      18,
    letterSpacing: -0.3,
  },
  statLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize:   11,
  },

  row: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowContent:  { flex: 1, gap: 3 },
  rowLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel:    { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  rowDesc:     { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },

  badge: {
    minWidth:          18,
    height:            18,
    borderRadius:      9,
    paddingHorizontal: 5,
    alignItems:        'center',
    justifyContent:    'center',
  },
  badgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize:   11,
    color:      '#FFFFFF',
  },
});
