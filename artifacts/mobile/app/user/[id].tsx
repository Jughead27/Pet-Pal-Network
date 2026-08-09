/**
 * Public profile screen — read-only view of another member.
 *
 * Shows displayName, city, bio, social links, and the pets they own or
 * co-own (tappable to the pet profile). Canonical home for the person-level
 * report + block actions (reusing ReportFlow and the /api/blocks mechanism).
 *
 * Blocking: the API returns 404 when the user doesn't exist OR either party
 * has blocked the other — both render the same "Profile not found" state.
 *
 * Own profile: entry points route the viewer's own id to the Profile tab
 * instead, but if this screen is ever reached with the viewer's own id it
 * redirects there too — never a "public" view of yourself with report/block.
 */

import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useLocalSearchParams, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import {
  useGetUserProfile,
  getGetFeedQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import ReportFlow from '@/components/ReportFlow';

const SOCIAL_LABELS: Array<{ key: 'instagram' | 'facebook' | 'linkedin' | 'xTwitter' | 'tiktok'; label: string }> = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook',  label: 'Facebook' },
  { key: 'linkedin',  label: 'LinkedIn' },
  { key: 'xTwitter',  label: 'X' },
  { key: 'tiktok',    label: 'TikTok' },
];

export default function PublicProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId: myUserId } = useAuth();
  const queryClient = useQueryClient();

  const [reportOpen,   setReportOpen]   = useState(false);
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [blocking,     setBlocking]     = useState(false);

  const isOwn = !!id && !!myUserId && id === myUserId;

  const { data: profile, isLoading, isError } = useGetUserProfile(id ?? '', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { enabled: !!id && !isOwn } as any,
  });

  // Same block mechanism as the post-detail entry point — POST /api/blocks,
  // invalidate the feed so their content disappears, then leave the screen.
  const handleBlock = useCallback(async () => {
    if (blocking || !id) return;
    setBlocking(true);
    try {
      await customFetch<{ ok: boolean }>('/api/blocks', {
        method: 'POST',
        body: JSON.stringify({ blockedUserId: id }),
      });
      await queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
      router.back();
    } catch {
      // Silent — user can retry.
    } finally {
      setBlocking(false);
      setBlockConfirm(false);
    }
  }, [blocking, id, queryClient]);

  // Viewing yourself → your own Profile tab, never a public copy.
  if (isOwn) {
    return <Redirect href="/(tabs)/profile" />;
  }

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  if (isLoading) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (isError || !profile) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.background }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginBottom: 16 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
          Profile not found.
        </Text>
      </View>
    );
  }

  const displayName = profile.displayName?.trim() || 'a pshpsh member';
  const socials = SOCIAL_LABELS
    .map((s) => ({ ...s, value: profile[s.key]?.trim() }))
    .filter((s) => !!s.value);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ paddingTop: topInset + 8, paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>

        {/* Identity */}
        <View style={styles.section}>
          <Text style={[styles.displayName, { color: colors.foreground }]}>
            {displayName}
          </Text>
          {!!profile.locationCity?.trim() && (
            <Text style={[styles.city, { color: colors.mutedForeground }]}>
              {profile.locationCity.trim()}
            </Text>
          )}
        </View>

        {/* Bio */}
        {!!profile.about?.trim() && (
          <View style={styles.section}>
            <Text style={[styles.about, { color: colors.foreground }]}>
              {profile.about.trim()}
            </Text>
          </View>
        )}

        {/* Socials */}
        {socials.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {socials.map((s) => (
              <View key={s.key} style={styles.socialRow}>
                <Text style={[styles.socialLabel, { color: colors.mutedForeground }]}>
                  {s.label}
                </Text>
                <Text
                  style={[styles.socialValue, { color: colors.foreground }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {s.value}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Pets */}
        {profile.pets.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              Pets
            </Text>
            {profile.pets.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => router.push(`/pet/${p.id}`)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`View ${p.name}'s profile`}
                style={[styles.petRow, { borderColor: colors.border }]}
              >
                <View style={styles.petRowText}>
                  <Text style={[styles.petName, { color: colors.foreground }]}>
                    {p.name}
                  </Text>
                  <Text style={[styles.petMeta, { color: colors.mutedForeground }]}>
                    {p.breed ? `${p.species} · ${p.breed}` : p.species}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Report / block — quiet whisper row, canonical person-level actions ── */}
        <View style={styles.moderationRow}>
          <TouchableOpacity
            onPress={() => setReportOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`Report ${displayName}`}
            activeOpacity={0.7}
          >
            <Text style={[styles.whisper, { color: colors.mutedForeground }]}>
              report
            </Text>
          </TouchableOpacity>

          {!blockConfirm ? (
            <TouchableOpacity
              onPress={() => setBlockConfirm(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Block ${displayName}`}
              activeOpacity={0.7}
            >
              <Text style={[styles.whisper, { color: colors.mutedForeground }]}>
                block
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.blockConfirmRow}>
              <Text style={[styles.whisper, { color: colors.mutedForeground }]}>
                block this member?
              </Text>
              <TouchableOpacity
                onPress={handleBlock}
                disabled={blocking}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Confirm block"
                activeOpacity={0.7}
              >
                {blocking ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <Text style={[styles.whisperStrong, { color: colors.foreground }]}>yes</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setBlockConfirm(false)}
                disabled={blocking}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Cancel block"
                activeOpacity={0.7}
              >
                <Text style={[styles.whisper, { color: colors.mutedForeground }]}>cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Report flow — targetType 'user'; ownerUserId enables the done-step block whisper */}
      <ReportFlow
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="user"
        targetId={id ?? ''}
        ownerUserId={id ?? undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill:     { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  backBtn:  { paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' },
  section:  { paddingHorizontal: 20, marginTop: 12 },
  displayName: { fontSize: 24, fontWeight: '700' },
  city:        { fontSize: 14, marginTop: 4 },
  about:       { fontSize: 15, lineHeight: 22 },
  card: {
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  socialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  socialLabel: { fontSize: 13, fontWeight: '600' },
  socialValue: { fontSize: 14, marginLeft: 16, flexShrink: 1 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  petRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  petRowText: { flexShrink: 1, paddingRight: 12 },
  petName:    { fontSize: 16, fontWeight: '600' },
  petMeta:    { fontSize: 13, marginTop: 2 },
  moderationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 20,
    marginTop: 32,
  },
  blockConfirmRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  whisper:       { fontSize: 13 },
  whisperStrong: { fontSize: 13, fontWeight: '700' },
});
