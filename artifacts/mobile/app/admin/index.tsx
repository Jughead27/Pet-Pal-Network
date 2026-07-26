/**
 * Admin hub — boring-utility navigation to moderation surfaces.
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
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

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
    route:       '/admin/breeds' as const,
    label:       'Breed Suggestions',
    description: 'Approve or reject "Not listed" free-text breed submissions.',
  },
  {
    route:       '/admin/log' as const,
    label:       'Audit Log',
    description: 'Chronological record of every admin action. Read-only.',
  },
];

export default function AdminIndexScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

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
          onPress={() => router.back()}
          style={styles.backRow}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={18} color={colors.mutedForeground} />
          <Text style={[styles.backText, { color: colors.mutedForeground }]}>back</Text>
        </TouchableOpacity>

        <Text style={[styles.heading, { color: colors.foreground }]}>admin</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          moderation & operations
        </Text>

        <View style={[styles.divider, { borderTopColor: colors.border }]} />

        {SECTIONS.map(({ route, label, description }) => (
          <TouchableOpacity
            key={route}
            onPress={() => router.push(route)}
            activeOpacity={0.7}
            style={[styles.row, { borderBottomColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <View style={styles.rowContent}>
              <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
              <Text style={[styles.rowDesc,  { color: colors.mutedForeground }]}>{description}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
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

  row: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowContent: { flex: 1, gap: 3 },
  rowLabel:   { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  rowDesc:    { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
});
