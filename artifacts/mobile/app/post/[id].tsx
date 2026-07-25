/**
 * Post Detail — contain-fit full-photo reading view.
 *
 * Shows the complete, uncropped image above the caption.
 * Reachable by tapping the caption area on any feed post.
 *
 * Data is looked up from the feed cache (always populated when navigating
 * from the feed or pet profile). Falls back to a graceful error state.
 *
 * Owners see a quiet "Delete post" row below the caption card. Tapping it
 * reveals an inline confirmation before issuing the DELETE request.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  getGetFeedQueryKey,
  getGetPetQueryKey,
  useDeletePost,
} from '@workspace/api-client-react';
import type { FeedPost, FeedResponse } from '@workspace/api-client-react';
import { resolveMediaKey } from '@/utils/mediaKey';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function PostDetailScreen() {
  const colors       = useColors();
  const insets       = useSafeAreaInsets();
  const { id }       = useLocalSearchParams<{ id: string }>();
  const queryClient  = useQueryClient();

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Look up the post from whichever cache has it.
  const feedData = queryClient.getQueryData<FeedResponse>(getGetFeedQueryKey());
  const post: FeedPost | undefined = feedData?.posts.find((p: FeedPost) => p.id === id);

  // Delete mutation — defined unconditionally (Rules of Hooks).
  // onSuccess: invalidate all affected queries then navigate away.
  const { mutate: doDelete, isPending: isDeleting } = useDeletePost({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey({ nursery: true }) });
        // Invalidate this pet's profile grid so the post disappears there too
        if (post?.pet.id) {
          queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(post.pet.id) });
        }
        router.back();
      },
    },
  });

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  // ── Render ────────────────────────────────────────────────────────────────

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
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Full-frame contain-fit photo */}
        <View style={[styles.photoWrapper, { paddingTop: topInset + 52 }]}>
          <Image
            source={photoSource}
            style={styles.photo}
            resizeMode="contain"
          />
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

          {post.pet.breed ? (
            <Text style={[styles.petBreed, { color: colors.mutedForeground }]}>
              {post.pet.breed}
            </Text>
          ) : null}

          {post.caption ? (
            <Text style={[styles.caption, { color: colors.foreground }]}>
              {post.caption}
            </Text>
          ) : (
            <Text style={[styles.emptyCaption, { color: colors.mutedForeground }]}>
              No caption
            </Text>
          )}
        </View>

        {/* ── Delete section — owner only ─────────────────────────────────── */}
        {post.pet.viewerOwnsPet && (
          <View
            style={[
              styles.deleteCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {!deleteConfirm ? (
              /* Initial state: quiet destructive row */
              <TouchableOpacity
                onPress={() => setDeleteConfirm(true)}
                style={styles.deleteRow}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Delete this post"
              >
                <Ionicons name="trash-outline" size={15} color={colors.destructive} />
                <Text style={[styles.deleteLabel, { color: colors.destructive }]}>
                  Delete post
                </Text>
              </TouchableOpacity>
            ) : (
              /* Confirm state: inline prompt + Cancel / Delete */
              <View style={styles.confirmBlock}>
                <Text style={[styles.confirmText, { color: colors.foreground }]}>
                  Delete this post? This can't be undone.
                </Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    onPress={() => setDeleteConfirm(false)}
                    disabled={isDeleting}
                    style={[styles.cancelBtn, { borderColor: colors.border }]}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => doDelete({ id: id! })}
                    disabled={isDeleting}
                    style={[styles.deleteBtn, { borderColor: colors.destructive }]}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm delete"
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color={colors.destructive} />
                    ) : (
                      <Text style={[styles.deleteBtnText, { color: colors.destructive }]}>
                        Delete
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill:    { flex: 1 },
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
    width: SCREEN_WIDTH,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH,   // square max — actual height driven by aspect via contain
    maxHeight: SCREEN_WIDTH * 1.5,
  },

  card: {
    margin: 16,
    marginBottom: 0,
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
  caption: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4,
  },
  emptyCaption: {
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 4,
  },

  // ── Delete card ────────────────────────────────────────────────────────────
  deleteCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  deleteLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },

  // Confirm state
  confirmBlock: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 14,
  },
  confirmText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  deleteBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  deleteBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});
