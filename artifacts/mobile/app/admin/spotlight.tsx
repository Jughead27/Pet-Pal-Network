/**
 * Spotlight management — admin control of the Sniff featured-pet banner.
 *
 * Shows current state (auto-resolved vs. manually pinned), a pet search to
 * pin any pet, a clear-override action (manual mode only), and the
 * auto-resolution window (days) editor. Pin and clear use the established
 * two-tap confirm pattern — they change what every member sees.
 */

import React, { useCallback, useState } from 'react';
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
import { ArrowLeft, ArrowClockwise } from 'phosphor-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { customFetch, getGetSpotlightQueryKey } from '@workspace/api-client-react';

interface SpotlightAdminState {
  mode:        'auto' | 'manual';
  pinnedPet:   { id: string; name: string } | null;
  resolvedPet: { id: string; name: string; coverPhotoUrl: string | null } | null;
  windowDays:  number;
}

interface SearchPet {
  id:   string;
  name: string;
}

export default function AdminSpotlightScreen() {
  const colors      = useColors();
  const insets      = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const topInset    = Platform.OS === 'web' ? 67 : insets.top;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-spotlight'],
    queryFn:  () => customFetch<SpotlightAdminState>('/api/admin/spotlight'),
  });

  // ── Pet search ─────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const { data: searchData, isFetching: searching } = useQuery({
    queryKey: ['admin-spotlight-pet-search', search],
    queryFn:  () => customFetch<{ pets: SearchPet[] }>(`/api/pets/search?q=${encodeURIComponent(search)}`),
    enabled:  search.trim().length > 0,
  });
  const results = searchData?.pets ?? [];

  // ── Mutations — two-tap confirm ────────────────────────────────────────────
  const [armedPinId, setArmedPinId] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const [mutating,   setMutating]   = useState(false);

  const afterMutate = useCallback(async () => {
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: getGetSpotlightQueryKey() }),
    ]);
  }, [refetch, queryClient]);

  const pin = useCallback(async (petId: string) => {
    if (mutating) return;
    setMutating(true);
    try {
      await customFetch('/api/admin/spotlight/pin', {
        method: 'POST',
        body:   JSON.stringify({ petId }),
      });
      setSearch('');
      setArmedPinId(null);
      setClearArmed(false); // never carry an armed clear across a state change
      await afterMutate();
    } finally {
      setMutating(false);
    }
  }, [mutating, afterMutate]);

  const clearPin = useCallback(async () => {
    if (mutating) return;
    setMutating(true);
    try {
      await customFetch('/api/admin/spotlight/clear', { method: 'POST' });
      setClearArmed(false);
      setArmedPinId(null);
      await afterMutate();
    } finally {
      setMutating(false);
    }
  }, [mutating, afterMutate]);

  // ── Window days ────────────────────────────────────────────────────────────
  const [daysInput,  setDaysInput]  = useState<string | null>(null);
  const [savingDays, setSavingDays] = useState(false);
  const [daysError,  setDaysError]  = useState<string | null>(null);

  const shownDays = daysInput ?? String(data?.windowDays ?? 7);
  const daysDirty = daysInput !== null && daysInput !== String(data?.windowDays ?? 7);

  const saveDays = useCallback(async () => {
    const parsed = parseInt(shownDays, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 90) {
      setDaysError('Enter a whole number between 1 and 90.');
      return;
    }
    setDaysError(null);
    setSavingDays(true);
    try {
      await customFetch('/api/admin/spotlight/config', {
        method: 'PATCH',
        body:   JSON.stringify({ windowDays: parsed }),
      });
      setDaysInput(null);
      await afterMutate();
    } finally {
      setSavingDays(false);
    }
  }, [shownDays, afterMutate]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.push('/admin')} style={styles.backBtn} accessibilityRole="button">
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Spotlight</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.refreshBtn} accessibilityRole="button">
          <ArrowClockwise size={16} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : isError || !data ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Could not load spotlight state.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Current state ── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>current</Text>
            <Text style={[styles.stateText, { color: colors.foreground }]}>
              {data.mode === 'manual'
                ? `Manually pinned — ${data.pinnedPet?.name ?? 'unknown pet'}`
                : data.resolvedPet
                  ? `Auto — showing ${data.resolvedPet.name}`
                  : 'Auto — no eligible pet (no banner shown)'}
            </Text>

            {data.mode === 'manual' && (
              mutating && clearArmed ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : clearArmed ? (
                <View style={styles.actions}>
                  <TouchableOpacity onPress={clearPin} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Confirm clear override">
                    <Text style={[styles.actionText, { color: colors.destructive ?? '#c04545' }]}>confirm — return to auto</Text>
                  </TouchableOpacity>
                  <Text style={[styles.sep, { color: colors.border }]}>·</Text>
                  <TouchableOpacity onPress={() => setClearArmed(false)} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Cancel">
                    <Text style={[styles.actionText, { color: colors.mutedForeground }]}>cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => { setClearArmed(true); setArmedPinId(null); }} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Clear override, return to auto">
                  <Text style={[styles.actionText, { color: colors.foreground }]}>clear override / return to auto</Text>
                </TouchableOpacity>
              )
            )}
          </View>

          {/* ── Pin a pet ── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>pin a pet</Text>
            <TextInput
              value={search}
              onChangeText={(t) => { setSearch(t); setArmedPinId(null); }}
              placeholder="Search pets by name or owner…"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={colors.mutedForeground} />}
            {search.trim().length > 0 && !searching && results.length === 0 && (
              <Text style={[styles.mutedText, { color: colors.mutedForeground }]}>No pets found.</Text>
            )}
            {results.map((pet) => (
              <View key={pet.id} style={styles.resultRow}>
                <Text style={[styles.resultName, { color: colors.foreground }]} numberOfLines={1}>{pet.name}</Text>
                {mutating && armedPinId === pet.id ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : armedPinId === pet.id ? (
                  <View style={styles.actions}>
                    <TouchableOpacity onPress={() => pin(pet.id)} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel={`Confirm pin ${pet.name}`}>
                      <Text style={[styles.actionText, { color: colors.foreground }]}>confirm pin</Text>
                    </TouchableOpacity>
                    <Text style={[styles.sep, { color: colors.border }]}>·</Text>
                    <TouchableOpacity onPress={() => setArmedPinId(null)} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Cancel">
                      <Text style={[styles.actionText, { color: colors.mutedForeground }]}>cancel</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => { setArmedPinId(pet.id); setClearArmed(false); }} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel={`Pin ${pet.name}`}>
                    <Text style={[styles.actionText, { color: colors.foreground }]}>pin</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          {/* ── Window ── */}
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>auto window (days)</Text>
            <Text style={[styles.mutedText, { color: colors.mutedForeground }]}>
              Treats received over this many days decide the auto pick.
            </Text>
            <View style={styles.daysRow}>
              <TextInput
                value={shownDays}
                onChangeText={(t) => { setDaysInput(t.replace(/[^0-9]/g, '')); setDaysError(null); }}
                keyboardType="number-pad"
                style={[styles.input, styles.daysInput, { color: colors.foreground, borderColor: colors.border }]}
                accessibilityLabel="Spotlight window in days"
              />
              {savingDays ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : daysDirty ? (
                <TouchableOpacity onPress={saveDays} style={styles.actionBtn} accessibilityRole="button" accessibilityLabel="Save window days">
                  <Text style={[styles.actionText, { color: colors.foreground }]}>save</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {daysError && <Text style={[styles.mutedText, { color: colors.destructive ?? '#c04545' }]}>{daysError}</Text>}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill:     { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:     { paddingHorizontal: 16, paddingTop: 12, gap: 12 },

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
    padding: 14, gap: 10,
  },
  cardLabel: {
    fontFamily: 'Inter_400Regular', fontSize: 12,
    letterSpacing: 0.6, textTransform: 'lowercase',
  },
  stateText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  mutedText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },

  input: {
    borderWidth: StyleSheet.hairlineWidth, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    fontFamily: 'Inter_400Regular', fontSize: 14,
  },
  daysRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  daysInput: { width: 80, textAlign: 'center' },

  resultRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: 12,
    paddingVertical: 4,
  },
  resultName: { fontFamily: 'Inter_500Medium', fontSize: 14, flex: 1 },

  actions:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBtn:  { paddingVertical: 4, paddingHorizontal: 2 },
  actionText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  sep:        { fontSize: 13, paddingHorizontal: 2 },
});
