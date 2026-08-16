/**
 * Post Detail — contain-fit full-photo reading view.
 *
 * Shows the complete, uncropped image above the caption.
 * Reachable by tapping the caption area (↗) on any feed post.
 *
 * Data is looked up from the feed cache (always populated when navigating
 * from the feed). Falls back to a graceful error state.
 *
 * View-only for all viewers — delete is in the pet-profile post modal.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Image } from 'react-native';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColumnWidth } from '@/hooks/useColumnWidth';
import MediaImage from '@/components/MediaImage';
import FocalImage from '@/components/FocalImage';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { getGetFeedQueryKey, useRemovePostPetTag, customFetch } from '@workspace/api-client-react';
import type { FeedPost, FeedResponse } from '@workspace/api-client-react';
import { resolveMediaKey } from '@/utils/mediaKey';

// The feed cache holds two shapes under '/api/feed'-prefixed keys: plain
// FeedResponse entries (grid screens' useGetFeed) and InfiniteData pages
// (Home/Sniff/Nursery pagers' useGetFeedInfinite under 'infinite'-suffixed
// keys). The Aug 14 pagination migration means the bare ['/api/feed'] key is
// never populated, so lookups/writes must prefix-match across ALL entries.
type FeedCacheData = FeedResponse | InfiniteData<FeedResponse> | undefined;

const feedPagesOf = (data: FeedCacheData): FeedResponse[] => {
  if (!data) return [];
  if ('pages' in data && Array.isArray(data.pages)) return data.pages;
  return [data as FeedResponse];
};
import { formatPostAge } from '@/utils/formatPostAge';
import ReportFlow from '@/components/ReportFlow';

export default function PostDetailScreen() {
  const colors        = useColors();
  // columnWidth is capped at COLUMN_MAX_WIDTH on web so the photo frame
  // matches the phone column, not the full browser window.
  const columnWidth   = useColumnWidth();
  const { width: winW, height: winH } = useWindowDimensions();
  const insets        = useSafeAreaInsets();
  const { id }        = useLocalSearchParams<{ id: string }>();
  const queryClient   = useQueryClient();
  const [reportOpen,     setReportOpen]     = useState(false);
  const [removingTagId,  setRemovingTagId]  = useState<string | null>(null);
  // Direct block entry point — inline confirm, reuses the existing /api/blocks
  // mechanism (same as the post-report "block this owner" step).
  const [blockConfirm,   setBlockConfirm]   = useState(false);
  const [blocking,       setBlocking]       = useState(false);

  // ── Admin hide/unhide — admin-only, direct (no report required) ───────────
  // isAdmin is server-sourced from the same cached query the profile uses.
  const { data: inviteData } = useQuery({
    queryKey: ['my-invites'],
    queryFn:  () => customFetch<{ isAdmin: boolean }>('/api/invites/mine'),
  });
  const isAdmin = inviteData?.isAdmin ?? false;
  // Local visibility state — a post reachable here is visible, so it starts
  // un-hidden unless the cache says otherwise; toggles optimistically.
  const [adminHidden,  setAdminHidden]  = useState<boolean | null>(null);
  const [hideConfirm,  setHideConfirm]  = useState(false);
  const [hiding,       setHiding]       = useState(false);

  const handleAdminHideToggle = useCallback(async (currentlyHidden: boolean) => {
    if (hiding || !id) return;
    setHiding(true);
    try {
      await customFetch<{ ok: boolean }>(
        `/api/admin/posts/${id}/${currentlyHidden ? 'unhide' : 'hide'}`,
        { method: 'POST' },
      );
      setAdminHidden(!currentlyHidden);
      // Hidden posts are filtered from public reads — drop the cached feed so
      // it reconciles on next fetch.
      await queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
    } catch { /* silent — state stays as-is, admin can retry */ } finally {
      setHiding(false);
      setHideConfirm(false);
    }
  }, [hiding, id, queryClient]);

  const { mutateAsync: removeTag } = useRemovePostPetTag();

  const handleRemoveTag = useCallback(async (petId: string) => {
    if (!id || removingTagId) return;
    setRemovingTagId(petId);
    try {
      await removeTag({ id, petId });
      // Optimistically remove the pet from the feed cache so the row
      // disappears immediately without waiting for a refetch.
      queryClient.setQueriesData<FeedCacheData>({ queryKey: getGetFeedQueryKey() }, (old) => {
        if (!old) return old;
        // The '/api/feed' prefix also matches non-feed entries (species /
        // breed-option caches) — leave anything without a posts array alone.
        const stripTag = (page: FeedResponse): FeedResponse =>
          Array.isArray(page?.posts)
            ? {
                ...page,
                posts: page.posts.map((p) =>
                  p.id === id
                    ? { ...p, taggedPets: (p.taggedPets ?? []).filter((tp) => tp.id !== petId) }
                    : p
                ),
              }
            : page;
        if ('pages' in old && Array.isArray(old.pages)) {
          return { ...old, pages: old.pages.map(stripTag) };
        }
        return stripTag(old as FeedResponse);
      });
    } catch {
      // Silent — the tag stays visible if the request failed.
    } finally {
      setRemovingTagId(null);
    }
  }, [id, removingTagId, removeTag, queryClient]);

  const handleBlockOwner = useCallback(async (ownerUserId: string) => {
    if (blocking) return;
    setBlocking(true);
    try {
      await customFetch<{ ok: boolean }>('/api/blocks', {
        method: 'POST',
        body: JSON.stringify({ blockedUserId: ownerUserId }),
      });
      // Their content is now hidden from the viewer — leave the post screen
      // and drop the cached feed so it refetches without the blocked pet.
      await queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
      router.back();
    } catch {
      // Silent — row stays; user can retry.
    } finally {
      setBlocking(false);
      setBlockConfirm(false);
    }
  }, [blocking, queryClient]);

  // Look up the post across every populated feed cache entry — the pagers
  // store InfiniteData under 'infinite'-suffixed keys and the grids store
  // plain FeedResponse entries with params; prefix-match them all and take
  // the first hit.
  let post: FeedPost | undefined;
  for (const [, data] of queryClient.getQueriesData<FeedCacheData>({ queryKey: getGetFeedQueryKey() })) {
    for (const page of feedPagesOf(data)) {
      const hit = page.posts?.find((p: FeedPost) => p.id === id);
      if (hit) { post = hit; break; }
    }
    if (post) break;
  }

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  // Natural photo size — needed to derive the crop rect's display aspect.
  const [natSize, setNatSize] = useState<{ w: number; h: number } | null>(null);
  const mediaUriForSize = post ? resolveMediaKey(post.mediaKey, post.mediaUrl) : null;
  const natUri = mediaUriForSize && typeof mediaUriForSize === 'object' && 'uri' in mediaUriForSize
    ? (mediaUriForSize as { uri: string }).uri
    : null;
  useEffect(() => {
    if (!natUri) return;
    let live = true;
    Image.getSize(natUri, (w, h) => { if (live) setNatSize({ w, h }); }, () => {});
    return () => { live = false; };
  }, [natUri]);

  if (!post) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
          Post not found.
        </Text>
      </View>
    );
  }

  const photoSource = resolveMediaKey(post.mediaKey, post.mediaUrl);

  // Complete crop rect (all four fields, positive dims) — FocalImage requires
  // all four; a partial rect must fall back to the legacy contain rendering.
  const hasFullCropRect =
    typeof post.cropX === 'number' && typeof post.cropY === 'number' &&
    typeof post.cropW === 'number' && typeof post.cropH === 'number' &&
    post.cropW > 0 && post.cropH > 0;

  // Frame height so the container aspect equals the crop rect's own aspect —
  // the rect then renders exactly (WYSIWYG), with the fill color in any space
  // the photo doesn't cover. Needs the photo's natural size.
  const rectAspect = hasFullCropRect && natSize
    ? ((post.cropW as number) * natSize.w) / Math.max((post.cropH as number) * natSize.h, 1e-6)
    : null;
  const cropFrameHeight = Math.min(
    rectAspect ? columnWidth / rectAspect : columnWidth * 1.5,
    winH * 0.75,
  );

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.back()}
        style={[styles.backBtn, { top: topInset + 8 }]}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color="#F0F4F8" />
      </TouchableOpacity>

      <ScrollView
        style={styles.fill}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Photo — respects the poster's crop rect/mode + fill color so the
            detail view is WYSIWYG with what the poster framed. The container
            aspect matches the CROP RECT itself (via the photo's natural size),
            so the rect renders exactly — no further cropping. Legacy posts
            without a complete crop rect keep the old contain-fit MediaImage. */}
        <View style={[styles.photoWrapper, { paddingTop: topInset + 52, width: columnWidth }]}>
          {hasFullCropRect ? (
            <FocalImage
              source={photoSource}
              style={[styles.photo, { width: columnWidth, height: cropFrameHeight }]}
              focusX={post.cropFocusX}
              focusY={post.cropFocusY}
              cropX={post.cropX ?? null}
              cropY={post.cropY ?? null}
              cropW={post.cropW ?? null}
              cropH={post.cropH ?? null}
              mode={post.cropMode ?? null}
              cropFillColor={post.cropFillColor ?? null}
              cropFillThumb={post.cropFillThumb ?? null}
            />
          ) : (
            <MediaImage
              source={photoSource}
              style={[styles.photo, { width: columnWidth, height: columnWidth, maxHeight: columnWidth * 1.5 }]}
              resizeMode="contain"
            />
          )}
        </View>

        {/* Caption card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => router.push(`/pet/${post.pet.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`View ${post.pet.name}'s profile`}
          >
            <Text style={[styles.petName, { color: colors.primary }]}>
              {post.pet.name}
            </Text>
          </TouchableOpacity>

          {/* Other tagged pets — each pet on its own row so the remove-tag
              whisper can sit inline without fighting nested-Text onPress. */}
          {(post.taggedPets ?? []).filter(tp => tp.id !== post.pet.id).length > 0 && (
            <View style={styles.taggedPetsRow}>
              <Text style={[styles.taggedWith, { color: colors.mutedForeground }]}>
                also with
              </Text>
              {(post.taggedPets ?? []).filter(tp => tp.id !== post.pet.id).map((tp) => (
                <View key={tp.id} style={styles.taggedPetLine}>
                  <TouchableOpacity
                    onPress={() => router.push(`/pet/${tp.id}` as never)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.taggedPetLink, { color: colors.primary }]}>
                      {tp.name}
                    </Text>
                  </TouchableOpacity>

                  {/* "remove tag" — only shown to the owner of this specific pet.
                      Matches the reportWhisper style: tiny, muted, typographic. */}
                  {tp.viewerOwnsPet && (
                    <TouchableOpacity
                      onPress={() => handleRemoveTag(tp.id)}
                      disabled={removingTagId === tp.id}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.removeTagBtn}
                    >
                      {removingTagId === tp.id ? (
                        <ActivityIndicator size="small" color={colors.mutedForeground} style={{ transform: [{ scale: 0.5 }] }} />
                      ) : (
                        <Text style={[styles.removeTagWhisper, { color: colors.mutedForeground }]}>
                          remove tag
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}

          {post.pet.breed ? (
            <Text style={[styles.petBreed, { color: colors.mutedForeground }]}>
              {post.pet.breed}
            </Text>
          ) : null}

          {post.caption ? (
            <Text style={[styles.caption, { color: colors.foreground }]}>
              {post.caption}
            </Text>
          ) : null}

          {/* Posted by — tappable to the poster's profile (own posts → Profile tab) */}
          {!!post.authorId && (
            <Text style={[styles.postedBy, { color: colors.mutedForeground }]} numberOfLines={1} ellipsizeMode="tail">
              {'Posted by '}
              <Text
                style={[styles.postedByName, { color: colors.foreground }]}
                suppressHighlighting
                accessibilityRole="button"
                accessibilityLabel={`View ${post.authorDisplayName?.trim() || 'this member'}'s profile`}
                onPress={() =>
                  post.viewerIsAuthor
                    ? router.push('/(tabs)/profile')
                    : router.push(`/user/${post.authorId}`)
                }
              >
                {post.authorDisplayName?.trim() || 'a pshpsh member'}
              </Text>
            </Text>
          )}

          {/* Admin-only hidden indicator — hidden content is filtered from
              public reads, so only the admin viewing this screen sees it. */}
          {isAdmin && (adminHidden ?? !!(post as unknown as { hiddenByAdmin?: boolean }).hiddenByAdmin) && (
            <Text style={[styles.hiddenIndicator, { color: '#EF4444' }]}>
              hidden by admin — not visible to members
            </Text>
          )}

          {/* Timestamp + report whisper — same row, timestamp left, report right */}
          <View style={styles.timestampRow}>
            <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>
              {formatPostAge(post.createdAt)}
            </Text>
            <View style={styles.whisperCluster}>
              {/* Admin hide/unhide — direct, no report required. Two-tap
                  confirm, same typographic pattern as block. Admin only. */}
              {isAdmin && (() => {
                const hidden = adminHidden ?? !!(post as unknown as { hiddenByAdmin?: boolean }).hiddenByAdmin;
                return hideConfirm ? (
                  <>
                    <Text style={[styles.reportWhisper, { color: colors.mutedForeground }]}>
                      {hidden ? 'unhide this post?' : 'hide this post?'}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleAdminHideToggle(hidden)}
                      disabled={hiding}
                      accessibilityRole="button"
                      accessibilityLabel={hidden ? 'Confirm unhide' : 'Confirm hide'}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.reportWhisper, { color: '#EF4444', opacity: hiding ? 0.4 : 1 }]}>
                        yes
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setHideConfirm(false)}
                      disabled={hiding}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.reportWhisper, { color: colors.mutedForeground }]}>
                        cancel
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    onPress={() => setHideConfirm(true)}
                    accessibilityRole="button"
                    accessibilityLabel={hidden ? 'Unhide this post' : 'Hide this post'}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[styles.reportWhisper, { color: colors.mutedForeground }]}>
                      {hidden ? 'unhide' : 'hide'}
                    </Text>
                  </TouchableOpacity>
                );
              })()}
              {/* Direct block — only when the viewer doesn't own this pet */}
              {(() => {
                const ownerUserId = (post.pet as unknown as { ownerId?: string }).ownerId;
                const viewerOwnsPet = (post.taggedPets ?? []).find((tp) => tp.id === post.pet.id)?.viewerOwnsPet;
                if (!ownerUserId || viewerOwnsPet) return null;
                return blockConfirm ? (
                  <>
                    <Text style={[styles.reportWhisper, { color: colors.mutedForeground }]}>
                      block this owner?
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleBlockOwner(ownerUserId)}
                      disabled={blocking}
                      accessibilityRole="button"
                      accessibilityLabel="Confirm block"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.reportWhisper, { color: '#EF4444', opacity: blocking ? 0.4 : 1 }]}>
                        yes
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setBlockConfirm(false)}
                      disabled={blocking}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel block"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[styles.reportWhisper, { color: colors.mutedForeground }]}>
                        cancel
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    onPress={() => setBlockConfirm(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Block this pet's owner"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[styles.reportWhisper, { color: colors.mutedForeground }]}>
                      block
                    </Text>
                  </TouchableOpacity>
                );
              })()}
              <TouchableOpacity
                onPress={() => setReportOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Report this post"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.reportWhisper, { color: colors.mutedForeground }]}>
                  report
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Report flow — post.  ownerId comes from the feed cache (field added server-side). */}
      <ReportFlow
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="post"
        targetId={id ?? ''}
        ownerUserId={(post.pet as unknown as { ownerId?: string }).ownerId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill:     { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },

  backBtn: {
    position: 'absolute',
    left: 14,
    zIndex: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(6,11,16,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoWrapper: {
    // width set inline from columnWidth — capped at 430 on web desktop.
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    // width/height/maxHeight set inline from columnWidth — capped at 430 on web desktop.
  },

  card: {
    margin: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 6,
  },
  petName: {
    fontSize: 15,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  petBreed: {
    fontSize: 12,
    fontWeight: '500' as const,
    marginTop: -2,
  },
  taggedPetsRow: {
    marginTop: 4,
  },
  taggedWith: {
    fontSize: 11,
    opacity: 0.55,
    fontFamily: 'Inter_400Regular',
    marginBottom: 2,
  },
  taggedPetLine: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            8,
    marginBottom:   1,
  },
  taggedPetLink: {
    fontSize:     13,
    fontFamily:   'Inter_500Medium',
  },
  postedBy: {
    fontSize:   12,
    fontFamily: 'Inter_400Regular',
    marginTop:  8,
  },
  postedByName: {
    fontFamily: 'Inter_600SemiBold',
    textDecorationLine: 'underline',
  },
  removeTagBtn: {
    justifyContent: 'center',
  },
  // Matches reportWhisper — barely-there typographic action.
  removeTagWhisper: {
    fontSize:   11,
    opacity:    0.35,
    fontFamily: 'Inter_400Regular',
  },
  caption: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4,
  },
  // Timestamp and report whisper share a row
  timestampRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginTop:       2,
  },
  timestamp: {
    fontSize:   12,
    opacity:    0.4,
    fontFamily: 'Inter_400Regular',
  },
  // block + report whispers share the right side of the timestamp row
  whisperCluster: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           14,
  },
  // Admin-only hidden-content indicator
  hiddenIndicator: {
    fontSize:   11,
    fontFamily: 'Inter_500Medium',
    marginTop:  6,
  },
  // "report" — smallest muted text, barely visible, per copy-law spec
  reportWhisper: {
    fontSize:   11,
    opacity:    0.35,
    fontFamily: 'Inter_400Regular',
  },
});
