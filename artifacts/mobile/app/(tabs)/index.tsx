/**
 * Home Feed — full-bleed single pet post.
 *
 * Layout (portrait, edge-to-edge):
 *  - Full-bleed hero image fills the screen
 *  - Gradient overlay fades from transparent (top) to dark (bottom)
 *  - Bottom-left: pet name, breed, caption, Add to Pack
 *  - Right edge: ActionRail (Boop, Treat, Comment, Share)
 *  - Top: Fish Book wordmark
 */

import React, { useState } from 'react';
import {
  Dimensions,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import ActionRail from '@/components/ActionRail';
import AddToPackLink from '@/components/AddToPackLink';
import CommentSheet from '@/components/CommentSheet';
import ShareSheet from '@/components/ShareSheet';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Pet images map ───────────────────────────────────────────────────────────
const PET_IMAGES = {
  hero: require('@/assets/images/ripley-hero.jpg'),
  post1: require('@/assets/images/ripley-post1.jpg'),
  post2: require('@/assets/images/ripley-post2.jpg'),
} as const;

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { pet } = useApp();
  const [commentSheetVisible, setCommentSheetVisible] = useState(false);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);

  // Always show the first post on the home feed
  const featuredPost = pet.posts[0];
  const heroImage = PET_IMAGES[featuredPost.imageKey];

  // Web-only top inset
  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={styles.container}>
      {/* Full-bleed hero image */}
      <Image
        source={heroImage}
        style={styles.heroImage}
        resizeMode="cover"
      />

      {/* Bottom gradient overlay */}
      <LinearGradient
        colors={['transparent', 'rgba(6,11,16,0.55)', 'rgba(6,11,16,0.92)']}
        locations={[0.3, 0.65, 1]}
        style={styles.gradient}
      />

      {/* Fish Book wordmark — top-left */}
      <View style={[styles.wordmark, { top: topInset + 12 }]}>
        <Text style={styles.wordmarkText}>Fish Book</Text>
      </View>

      {/* ActionRail — right edge, vertically centered */}
      <View style={[styles.railContainer, { bottom: insets.bottom + (Platform.OS === 'web' ? 84 : 90) }]}>
        <ActionRail
          onCommentPress={() => setCommentSheetVisible(true)}
          onSharePress={() => setShareSheetVisible(true)}
        />
      </View>

      {/* Pet info — bottom-left */}
      <View
        style={[
          styles.petInfo,
          {
            bottom: insets.bottom + (Platform.OS === 'web' ? 84 : 90),
            right: 80, // leave space for the action rail
          },
        ]}
      >
        {/* Pet name — tappable, navigates to profile */}
        <TouchableOpacity
          onPress={() => router.push(`/pet/${pet.id}`)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`View ${pet.name}'s profile`}
        >
          <Text style={styles.petName}>{pet.name}</Text>
        </TouchableOpacity>

        <Text style={[styles.petBreed, { color: 'rgba(240,244,248,0.75)' }]}>
          {pet.breed}
        </Text>

        <Text style={[styles.petCaption, { color: 'rgba(240,244,248,0.9)' }]} numberOfLines={2}>
          {featuredPost.caption}
        </Text>

        {/* Add to Pack — below the caption */}
        <View style={styles.packRow}>
          <AddToPackLink />
        </View>
      </View>

      {/* Sheets */}
      <CommentSheet
        visible={commentSheetVisible}
        onClose={() => setCommentSheetVisible(false)}
      />
      <ShareSheet
        visible={shareSheetVisible}
        onClose={() => setShareSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060B10',
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCREEN_HEIGHT * 0.65,
  },
  wordmark: {
    position: 'absolute',
    left: 18,
  },
  wordmarkText: {
    color: '#F0F4F8',
    fontSize: 18,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    // Subtle shadow for legibility over image
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  railContainer: {
    position: 'absolute',
    right: 14,
  },
  petInfo: {
    position: 'absolute',
    left: 18,
    gap: 3,
  },
  petName: {
    color: '#F0F4F8',
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  petBreed: {
    fontSize: 13,
    fontWeight: '500' as const,
    letterSpacing: 0.3,
  },
  petCaption: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    fontStyle: 'italic',
  },
  packRow: {
    marginTop: 6,
  },
});
