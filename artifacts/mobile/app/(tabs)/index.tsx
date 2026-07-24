/**
 * Home Feed — full-bleed single pet post.
 *
 * Gestures:
 *   Single tap on media  → toggle chrome (name/rail/scrim fade 200ms)
 *   Double tap on media  → boop (same as rail Boop button)
 *   Tap "more/less"      → expand / collapse caption
 */

import React, { useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
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

const PET_IMAGES = {
  hero: require('@/assets/images/ripley-hero.jpg'),
  post1: require('@/assets/images/ripley-post1.jpg'),
  post2: require('@/assets/images/ripley-post2.jpg'),
} as const;

// Shared text-shadow style applied to all overlay text for legibility
const TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.4)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { pet, boop } = useApp();

  const [commentSheetVisible, setCommentSheetVisible] = useState(false);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [captionNeedsMore, setCaptionNeedsMore] = useState(false);

  // Chrome visibility — single-tap toggles, resets to visible per post
  const chromeVisibleRef = useRef(true);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeOpacity = useSharedValue(1);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));

  // Double-tap detection timer
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const featuredPost = pet.posts[0];
  const heroImage = PET_IMAGES[featuredPost.imageKey];

  const bottomOffset = insets.bottom + (Platform.OS === 'web' ? 110 : 116);

  // ── Gesture handler ──────────────────────────────────────────────────────────
  const handleMediaPress = () => {
    if (tapTimerRef.current) {
      // Second tap within window → double tap → boop
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      boop();
    } else {
      // Start window; if no second tap arrives, toggle chrome
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        const next = !chromeVisibleRef.current;
        chromeVisibleRef.current = next;
        setChromeVisible(next);
        chromeOpacity.value = withTiming(next ? 1 : 0, { duration: 200 });
      }, 280);
    }
  };

  return (
    <View style={styles.container}>
      {/* ── Full-bleed hero image ── */}
      <Image source={heroImage} style={styles.heroImage} resizeMode="cover" />

      {/* ── Media tap target — sits behind all overlays ── */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleMediaPress} />

      {/* ── Legibility scrim — fades with chrome ── */}
      <Animated.View style={[styles.scrim, chromeStyle]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(0,0,0,0.65)', 'rgba(0,0,0,0.25)', 'transparent']}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 1 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* ── ActionRail — right edge ── */}
      <Animated.View
        style={[styles.railContainer, { bottom: bottomOffset }, chromeStyle]}
        pointerEvents={chromeVisible ? 'box-none' : 'none'}
      >
        <ActionRail
          onCommentPress={() => setCommentSheetVisible(true)}
          onSharePress={() => setShareSheetVisible(true)}
        />
      </Animated.View>

      {/* ── Pet info — bottom-left ── */}
      <Animated.View
        style={[styles.petInfo, { bottom: bottomOffset, right: 80 }, chromeStyle]}
        pointerEvents={chromeVisible ? 'box-none' : 'none'}
      >
        {/* Identity row: name + pack toggle */}
        <View style={styles.identityRow}>
          <TouchableOpacity
            onPress={() => router.push(`/pet/${pet.id}`)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`View ${pet.name}'s profile`}
          >
            <Text style={styles.petName}>{pet.name}</Text>
          </TouchableOpacity>
          <AddToPackLink />
        </View>

        <Text style={[styles.petBreed, { color: 'rgba(240,244,248,0.75)' }]}>
          {pet.breed}
        </Text>

        {/* Caption with expand/collapse */}
        <View>
          {/* Hidden full-text measurement — detects whether truncation occurs */}
          <Text
            style={[styles.petCaption, styles.captionMeasure]}
            onTextLayout={(e) => setCaptionNeedsMore(e.nativeEvent.lines.length > 2)}
          >
            {featuredPost.caption}
          </Text>

          <Text
            style={[styles.petCaption, { color: 'rgba(240,244,248,0.9)' }]}
            numberOfLines={captionExpanded ? undefined : 2}
          >
            {featuredPost.caption}
          </Text>

          {captionNeedsMore && (
            <TouchableOpacity
              onPress={() => setCaptionExpanded(v => !v)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.captionMore}>
                {captionExpanded ? 'less' : 'more'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* ── Sheets ── */}
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
  // Legibility scrim — covers bottom ~40% of screen
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCREEN_HEIGHT * 0.45,
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
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  petName: {
    color: '#F0F4F8',
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
    ...TEXT_SHADOW,
  },
  petBreed: {
    fontSize: 13,
    fontWeight: '500' as const,
    letterSpacing: 0.3,
    ...TEXT_SHADOW,
  },
  petCaption: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    fontStyle: 'italic',
    ...TEXT_SHADOW,
  },
  // Hidden full-text clone used only for line-count measurement
  captionMeasure: {
    position: 'absolute',
    opacity: 0,
    color: 'transparent',
    pointerEvents: 'none',
  },
  captionMore: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600' as const,
    color: 'rgba(240,244,248,0.55)',
    ...TEXT_SHADOW,
  },
});
