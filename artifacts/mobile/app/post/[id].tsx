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

import React, { useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColumnWidth } from '@/hooks/useColumnWidth';
import MediaImage from '@/components/MediaImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { getGetFeedQueryKey } from '@workspace/api-client-react';
import type { FeedPost, FeedResponse } from '@workspace/api-client-react';
import { resolveMediaKey } from '@/utils/mediaKey';
import { formatPostAge } from '@/utils/formatPostAge';
import ReportFlow from '@/components/ReportFlow';

export default function PostDetailScreen() {
  const colors        = useColors();
  // columnWidth is capped at COLUMN_MAX_WIDTH on web so the photo frame
  // matches the phone column, not the full browser window.
  const columnWidth   = useColumnWidth();
  const insets        = useSafeAreaInsets();
  const { id }        = useLocalSearchParams<{ id: string }>();
  const queryClient   = useQueryClient();
  const [reportOpen, setReportOpen] = useState(false);

  // Look up the post from the feed cache.
  const feedData = queryClient.getQueryData<FeedResponse>(getGetFeedQueryKey());
  const post: FeedPost | undefined = feedData?.posts.find((p: FeedPost) => p.id === id);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

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
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Full-frame contain-fit photo */}
        <View style={[styles.photoWrapper, { paddingTop: topInset + 52, width: columnWidth }]}>
          <MediaImage
            source={photoSource}
            style={[styles.photo, { width: columnWidth, height: columnWidth, maxHeight: columnWidth * 1.5 }]}
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
          ) : null}

          {/* Timestamp + report whisper — same row, timestamp left, report right */}
          <View style={styles.timestampRow}>
            <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>
              {formatPostAge(post.createdAt)}
            </Text>
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
      </ScrollView>

      {/* Report flow — post */}
      <ReportFlow
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="post"
        targetId={id ?? ''}
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
  // "report" — smallest muted text, barely visible, per copy-law spec
  reportWhisper: {
    fontSize:   11,
    opacity:    0.35,
    fontFamily: 'Inter_400Regular',
  },
});
