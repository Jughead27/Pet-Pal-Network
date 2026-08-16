/**
 * Merge suggestions — admin queue of user-submitted "same pet" suggestions.
 * Shows both pets side by side (suggester pet/owner vs target pet/owner).
 *
 * Actions: dismiss, or run the REAL merge — the admin must explicitly choose
 * which pet survives (no default), then confirm a summary of what will move
 * ("X posts, Y followers, Z co-owners will move…"), then the server performs
 * the whole migration in one transaction and returns what moved.
 */

import React, { useCallback, useState } from 'react';
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

interface Suggestion {
  id: string;
  createdAt: string;
  suggesterUserId: string;
  suggesterUsername: string | null;
  suggesterPetId: string;
  suggesterPetName: string;
  suggesterPetSpecies: string;
  suggesterPetBreed: string | null;
  targetPetId: string;
  targetPetName: string;
  targetPetSpecies: string;
  targetPetBreed: string | null;
  targetOwnerId: string;
  targetOwnerUsername: string | null;
  suggesterPetPosts: number;
  suggesterPetFollowers: number;
  suggesterPetOwners: number;
  targetPetPosts: number;
  targetPetFollowers: number;
  targetPetOwners: number;
}

interface MergeResult {
  ok: boolean;
  moved: {
    postsRetagged: number;
    primaryReassigned: number;
    followersMoved: number;
    coOwnersMoved: number;
  };
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export default function AdminMergeSuggestionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // Merge flow state — one suggestion at a time can be in the flow.
  // mergingId: card whose survivor picker is open; survivorPick: chosen pet.
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [survivorPick, setSurvivorPick] = useState<string | null>(null);
  // Result banner after a completed merge (persists until refresh removes card).
  const [lastResult, setLastResult] = useState<{ id: string; text: string } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-merge-suggestions'],
    queryFn: () => customFetch<{ suggestions: Suggestion[] }>('/api/admin/merge-suggestions'),
  });

  const suggestions = data?.suggestions ?? [];

  const resetFlow = useCallback(() => {
    setMergingId(null);
    setSurvivorPick(null);
  }, []);

  const dismiss = useCallback(async (id: string) => {
    if (pendingIds.has(id)) return;
    setPendingIds((s) => new Set(s).add(id));
    resetFlow();
    setErrorText(null);
    try {
      await customFetch(`/api/admin/merge-suggestions/${id}/dismiss`, { method: 'POST' });
      await refetch();
    } catch {
      setErrorText('dismiss failed — try again.');
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, [pendingIds, refetch, resetFlow]);

  const executeMerge = useCallback(async (item: Suggestion, survivorPetId: string) => {
    if (pendingIds.has(item.id)) return;
    const mergedPetId = survivorPetId === item.suggesterPetId ? item.targetPetId : item.suggesterPetId;
    setPendingIds((s) => new Set(s).add(item.id));
    setErrorText(null);
    try {
      const result = await customFetch<MergeResult>(
        `/api/admin/merge-suggestions/${item.id}/merge`,
        { method: 'POST', body: JSON.stringify({ survivorPetId, mergedPetId }) },
      );
      const m = result.moved;
      setLastResult({
        id: item.id,
        text: `merged. ${m.postsRetagged} post tag${m.postsRetagged === 1 ? '' : 's'} moved, ` +
              `${m.followersMoved} follower${m.followersMoved === 1 ? '' : 's'} moved, ` +
              `${m.coOwnersMoved} co-owner${m.coOwnersMoved === 1 ? '' : 's'} moved.`,
      });
      resetFlow();
      await refetch();
    } catch (e) {
      const err = e as { data?: { error?: string } };
      setErrorText(err.data?.error ?? 'merge failed — nothing was changed.');
    } finally {
      setPendingIds((s) => { const n = new Set(s); n.delete(item.id); return n; });
    }
  }, [pendingIds, refetch, resetFlow]);

  const petLine = (name: string, species: string, breed: string | null) =>
    `${name} · ${breed?.trim() || species}`;

  const renderItem = useCallback(({ item }: { item: Suggestion }) => {
    const isPending = pendingIds.has(item.id);
    const inMergeFlow = mergingId === item.id;

    // Merged-away pet stats for the confirm summary.
    const survivorIsSuggester = survivorPick === item.suggesterPetId;
    const mergedName    = survivorIsSuggester ? item.targetPetName      : item.suggesterPetName;
    const survivorName  = survivorIsSuggester ? item.suggesterPetName   : item.targetPetName;
    const mergedPosts   = survivorIsSuggester ? item.targetPetPosts     : item.suggesterPetPosts;
    const mergedFollows = survivorIsSuggester ? item.targetPetFollowers : item.suggesterPetFollowers;
    const mergedOwners  = survivorIsSuggester ? item.targetPetOwners    : item.suggesterPetOwners;

    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Side-by-side pets */}
        <View style={styles.pairRow}>
          <TouchableOpacity
            style={styles.petCol}
            onPress={() => router.push(`/pet/${item.suggesterPetId}`)}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.suggesterPetName}`}
          >
            <Text style={[styles.colLabel, { color: colors.mutedForeground }]}>suggester's pet</Text>
            <Text style={[styles.petName, { color: colors.foreground }]}>
              {petLine(item.suggesterPetName, item.suggesterPetSpecies, item.suggesterPetBreed)}
            </Text>
            <Text style={[styles.ownerName, { color: colors.mutedForeground }]}>
              @{item.suggesterUsername ?? 'unknown'}
            </Text>
            <Text style={[styles.statsLine, { color: colors.mutedForeground }]}>
              {item.suggesterPetPosts} posts · {item.suggesterPetFollowers} followers · {item.suggesterPetOwners} owners
            </Text>
          </TouchableOpacity>
          <Text style={[styles.pairSep, { color: colors.mutedForeground }]}>=?</Text>
          <TouchableOpacity
            style={styles.petCol}
            onPress={() => router.push(`/pet/${item.targetPetId}`)}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.targetPetName}`}
          >
            <Text style={[styles.colLabel, { color: colors.mutedForeground }]}>target pet</Text>
            <Text style={[styles.petName, { color: colors.foreground }]}>
              {petLine(item.targetPetName, item.targetPetSpecies, item.targetPetBreed)}
            </Text>
            <Text style={[styles.ownerName, { color: colors.mutedForeground }]}>
              @{item.targetOwnerUsername ?? 'unknown'}
            </Text>
            <Text style={[styles.statsLine, { color: colors.mutedForeground }]}>
              {item.targetPetPosts} posts · {item.targetPetFollowers} followers · {item.targetPetOwners} owners
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.age, { color: colors.mutedForeground }]}>
          submitted {relativeAge(item.createdAt)}
        </Text>

        {lastResult?.id === item.id && (
          <Text style={[styles.resultTxt, { color: colors.foreground }]}>{lastResult.text}</Text>
        )}
        {errorText && inMergeFlow && (
          <Text style={[styles.errorTxt, { color: colors.destructive }]}>{errorText}</Text>
        )}

        {isPending ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : !inMergeFlow ? (
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => { setMergingId(item.id); setSurvivorPick(null); setErrorText(null); }}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Merge these pets"
            >
              <Text style={[styles.actionText, { color: colors.foreground }]}>merge…</Text>
            </TouchableOpacity>
            <Text style={[styles.sep, { color: colors.border }]}>·</Text>
            <TouchableOpacity
              onPress={() => dismiss(item.id)}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Dismiss suggestion"
            >
              <Text style={[styles.actionText, { color: colors.mutedForeground }]}>dismiss</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mergeFlow}>
            {/* Survivor picker — deliberately no default */}
            <Text style={[styles.pickerLabel, { color: colors.mutedForeground }]}>
              which pet survives?
            </Text>
            <View style={styles.pickerRow}>
              {([
                { id: item.suggesterPetId, name: item.suggesterPetName },
                { id: item.targetPetId,   name: item.targetPetName },
              ] as const).map((p) => {
                const selected = survivorPick === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => setSurvivorPick(selected ? null : p.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.name} survives`}
                    style={[
                      styles.pickerChip,
                      { borderColor: selected ? colors.foreground : colors.border },
                      selected && { backgroundColor: colors.background },
                    ]}
                  >
                    <Text style={[styles.pickerChipTxt, { color: colors.foreground, opacity: selected ? 1 : 0.6 }]}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Confirm summary — only once a survivor is chosen */}
            {survivorPick && (
              <Text style={[styles.summaryTxt, { color: colors.foreground }]}>
                {mergedPosts} post{mergedPosts === 1 ? '' : 's'}, {mergedFollows} follower{mergedFollows === 1 ? '' : 's'}, {mergedOwners} co-owner{mergedOwners === 1 ? '' : 's'} will
                move from {mergedName} to {survivorName}. This can't be undone.
              </Text>
            )}

            <View style={styles.actions}>
              {survivorPick && (
                <>
                  <TouchableOpacity
                    onPress={() => executeMerge(item, survivorPick)}
                    style={styles.actionBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm merge"
                  >
                    <Text style={[styles.actionText, { color: colors.destructive }]}>merge now</Text>
                  </TouchableOpacity>
                  <Text style={[styles.sep, { color: colors.border }]}>·</Text>
                </>
              )}
              <TouchableOpacity
                onPress={() => { resetFlow(); setErrorText(null); }}
                style={styles.actionBtn}
                accessibilityRole="button"
                accessibilityLabel="Cancel merge"
              >
                <Text style={[styles.actionText, { color: colors.mutedForeground }]}>cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }, [colors, pendingIds, mergingId, survivorPick, lastResult, errorText, dismiss, executeMerge, resetFlow]);

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.push('/admin')} style={styles.backBtn} accessibilityRole="button">
          <ArrowLeft size={18} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Merge Suggestions</Text>
        <TouchableOpacity onPress={() => refetch()} style={styles.refreshBtn} accessibilityRole="button">
          <ArrowClockwise size={16} color={colors.mutedForeground} weight="regular" />
        </TouchableOpacity>
      </View>

      {lastResult && !suggestions.some((s) => s.id === lastResult.id) && (
        <Text style={[styles.resultBanner, { color: colors.foreground, borderBottomColor: colors.border }]}>
          {lastResult.text}
        </Text>
      )}

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : isError ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Could not load suggestions.</Text>
        </View>
      ) : suggestions.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>No merge suggestions pending.</Text>
        </View>
      ) : (
        <FlatList
          data={suggestions}
          keyExtractor={(s) => s.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  backBtn: { padding: 6 },
  refreshBtn: { padding: 6, marginLeft: 'auto' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, flex: 1 },

  resultBanner: {
    fontFamily: 'Inter_400Regular', fontSize: 13,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  card: {
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    padding: 14, gap: 10,
  },
  pairRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  petCol: { flex: 1, gap: 2 },
  pairSep: { fontFamily: 'Inter_400Regular', fontSize: 13, paddingTop: 18 },
  colLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  petName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  ownerName: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  statsLine: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  age: { fontFamily: 'Inter_400Regular', fontSize: 11, fontStyle: 'italic' },

  resultTxt: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  errorTxt: { fontFamily: 'Inter_400Regular', fontSize: 12 },

  mergeFlow: { gap: 10 },
  pickerLabel: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  pickerRow: { flexDirection: 'row', gap: 8 },
  pickerChip: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  pickerChipTxt: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  summaryTxt: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBtn: { paddingVertical: 4, paddingHorizontal: 2 },
  actionText: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  sep: { fontSize: 13, paddingHorizontal: 2 },
});
