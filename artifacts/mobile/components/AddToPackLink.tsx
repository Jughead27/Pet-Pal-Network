/**
 * AddToPackLink — server-backed pack follow/unfollow toggle.
 *
 * Reads and writes to PackContext so that all instances for the same pet
 * (e.g. multiple posts for Finn in the feed, or the same pet's feed post
 * and profile page) stay in sync without a full refetch.
 *
 * Optimistic update flow:
 *   1. Immediately flip state in PackContext (all instances for petId update).
 *   2. Fire the join / leave mutation.
 *   3. On success: call onSuccess(result) if provided (for pack count updates).
 *   4. On error: revert PackContext to prior state (all instances revert).
 *
 * Animation sync: a useEffect watches isInPack and syncs the Animated.Value
 * for instances that didn't trigger the mutation themselves (cross-post
 * consistency in the feed — Finn followed from post A immediately shows
 * active on posts B and C without a full refetch).
 *
 * Visual states:
 *   Inactive  outlined ring, paw in light foreground (dim)
 *   Active    solid light-filled ring, paw in dark background (inverted)
 *
 * Transition: 150ms cross-fade.  No react-native-reanimated.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useJoinPetPack, useLeavePetPack } from '@workspace/api-client-react';
import type { PackResult } from '@workspace/api-client-react';
import { usePackContext } from '@/context/PackContext';
import PawIcon from '@/components/PawIcon';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddToPackLinkProps {
  petId: string;
  /** Server-provided initial state; PackContext takes over after first mutation. */
  initialInPack: boolean;
  /** Called with the server's confirmed result after a successful toggle. */
  onSuccess?: (result: PackResult) => void;
}

// ─── AddToPackLink ────────────────────────────────────────────────────────────

export default function AddToPackLink({ petId, initialInPack, onSuccess }: AddToPackLinkProps) {
  const { packMap, setPackState } = usePackContext();

  // PackContext is authoritative once a key is set; fall back to server initial value.
  const isInPack = packMap[petId] ?? initialInPack;

  // Animated.Value drives the cross-fade between inactive (0) and active (1) rings.
  const progress = useRef(new Animated.Value(isInPack ? 1 : 0)).current;
  // True while a mutation is in flight — suppresses the external-sync useEffect
  // during the mutation so it doesn't fight the optimistic animation.
  const mutatingRef = useRef(false);

  const inactiveOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  // "following" label fades in subtly when active; invisible (not just dim) when not following.
  const labelOpacity    = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.58] });

  const { mutate: joinPack }  = useJoinPetPack();
  const { mutate: leavePack } = useLeavePetPack();

  const animateTo = useCallback((value: number) => {
    Animated.timing(progress, {
      toValue: value,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  // Sync animation when PackContext changes due to another instance toggling
  // the same pet (e.g., followed from the profile, should update feed posts).
  useEffect(() => {
    if (!mutatingRef.current) {
      animateTo(isInPack ? 1 : 0);
    }
  }, [isInPack, animateTo]);

  const handlePress = useCallback(() => {
    if (mutatingRef.current) return;
    mutatingRef.current = true;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const wasInPack = isInPack;
    const nextInPack = !wasInPack;

    // Optimistic update — all instances for this petId update immediately
    setPackState(petId, nextInPack);
    animateTo(nextInPack ? 1 : 0);

    const mutate = nextInPack ? joinPack : leavePack;
    mutate(
      { id: petId },
      {
        onSuccess: (result) => {
          // Sync with server-confirmed state (guards against out-of-order responses)
          setPackState(petId, result.viewerInPack);
          animateTo(result.viewerInPack ? 1 : 0);
          onSuccess?.(result);
          mutatingRef.current = false;
        },
        onError: () => {
          // Revert — all instances for this petId revert
          setPackState(petId, wasInPack);
          animateTo(wasInPack ? 1 : 0);
          mutatingRef.current = false;
        },
      },
    );
  }, [isInPack, petId, joinPack, leavePack, setPackState, animateTo, onSuccess]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={styles.touchable}
      testID="add-to-pack-button"
      accessibilityRole="button"
      accessibilityLabel={isInPack ? 'In your Pack' : 'Add to Pack'}
    >
      {/*
        Two ring layers share the same 26×26 space via absoluteFillObject.
        Cross-fading their opacity avoids interpolateColor (Reanimated-only).

        Inactive ring: transparent fill, dim border → fades out when active.
        Active ring:   solid light fill, light border → fades in when active.
      */}
      <View style={styles.ringContainer}>
        <Animated.View style={[styles.ring, styles.ringInactive, { opacity: inactiveOpacity }]}>
          <PawIcon size={14} color="rgba(240,244,248,0.80)" />
        </Animated.View>
        <Animated.View style={[styles.ring, styles.ringActive, { opacity: progress }]}>
          <PawIcon size={14} color="#060B10" />
        </Animated.View>
      </View>

      {/* Persistent follow-state label — visible only while following; typographic whisper. */}
      <Animated.Text style={[styles.followingLabel, { opacity: labelOpacity }]}>
        following
      </Animated.Text>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  touchable: {
    marginLeft: 6,
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: 7,
  },
  ringContainer: {
    width: 26,
    height: 26,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInactive: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(240,244,248,0.35)',
  },
  ringActive: {
    backgroundColor: '#F0F4F8',
    borderColor: '#F0F4F8',
  },
  // Persistent follow-state label — shown only when following (opacity driven by animation).
  // Intentionally small, italic, and muted: a typographic whisper, not a badge.
  followingLabel: {
    marginLeft: 3,
    fontSize: 10,
    fontStyle: 'italic' as const,
    color: 'rgba(240,244,248,1)',
    letterSpacing: -0.1,
    lineHeight: 14,
  },
});
