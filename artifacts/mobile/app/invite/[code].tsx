/**
 * Invite landing page — /invite/[code]
 *
 * Portal visual system: logo, "you're invited to pshpsh" headline, wordmark,
 * bold "join pshpsh" action.
 *
 * On mount: optionally validates the code against the API.
 * On "join pshpsh": stores code in SecureStore → pushes to /(auth)/sign-up.
 *
 * Works for both signed-in and signed-out visitors.
 * Signed-in users who tap "join pshpsh" are redirected by the (auth) guard.
 */

import React, { useEffect, useState } from 'react';
import { COLUMN_MAX_WIDTH } from '@/hooks/useColumnWidth';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { getBaseUrl } from '@workspace/api-client-react';

// ── Portal design tokens ───────────────────────────────────────────────────────
const BG    = '#060B10';
const FG    = '#F0F4F8';
const MUTED = '#6B7FA0';

const LOGO = require('@/assets/icon.png');

type Status = 'loading' | 'valid' | 'invalid' | 'joining';

interface CoPet { id: string; name: string; species: string | null }

/** "Ripley" · "Ripley and Finn" · "Ripley, Finn and Mochi" */
function formatPetNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export default function InviteLandingScreen() {
  const insets           = useSafeAreaInsets();
  const router           = useRouter();
  const { code }         = useLocalSearchParams<{ code: string }>();
  const [status, setStatus] = useState<Status>('loading');
  const [coPets, setCoPets] = useState<CoPet[]>([]);

  // ── Validate code on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (!code) { setStatus('invalid'); return; }
    const validate = async () => {
      try {
        const baseUrl = getBaseUrl() ?? '';
        const res  = await fetch(`${baseUrl}/api/invites/validate/${encodeURIComponent(code)}`);
        const data = await res.json() as {
          valid: boolean;
          coPets?: CoPet[];
        };
        if (data.valid) {
          setCoPets(data.coPets ?? []);
          setStatus('valid');
        } else {
          setStatus('invalid');
        }
      } catch {
        // Network error — allow attempting anyway
        setStatus('valid');
      }
    };
    validate();
  }, [code]);

  // ── "join pshpsh" action ──────────────────────────────────────────────────
  const handleJoin = async () => {
    if (!code) return;
    setStatus('joining');
    try {
      await SecureStore.setItemAsync('pendingInviteCode', code);
    } catch { /* non-fatal */ }
    // Navigate to sign-up with the code bound as a param
    router.push({ pathname: '/(auth)/sign-up', params: { inviteCode: code } });
  };

  const pt = insets.top + (Platform.OS === 'web' ? 24 : 48);
  const pb = insets.bottom + 40;

  if (status === 'loading') {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator color={FG} size="small" />
      </View>
    );
  }

  if (status === 'invalid') {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: pt, paddingBottom: pb }]}>
        <View style={styles.col}>
          <View style={styles.header}>
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />
            <Text style={styles.wordmark}>pshpsh</Text>
          </View>
          <Text style={styles.headline}>this invite has expired.</Text>
          <Text style={styles.sub}>the link is no longer valid. ask your friend for a fresh one.</Text>
          <Pressable
            onPress={() => router.push('/(auth)/sign-in')}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryTxt}>← sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.scroll, { paddingTop: pt, paddingBottom: pb }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.col}>
        {/* Portal header */}
        <View style={styles.header}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.wordmark}>pshpsh</Text>
        </View>

        {/* Headline — one headline + one supporting tagline, nothing stacked */}
        <Text style={styles.headline}>you're invited to pshpsh</Text>
        <Text style={styles.sub}>follow pets, not people.</Text>

        {/* Co-pet preview — only shown when the inviter pre-selected pets.
            Pronoun-based on purpose: never show the raw @username here. */}
        {coPets.length > 0 && (
          <Text style={styles.coPetPreview}>
            they'd like to share {formatPetNames(coPets.map((p) => p.name))} with you — you'll
            both be able to post {coPets.length > 1 ? 'their' : `${coPets[0].name}'s`} photos
            and updates.
          </Text>
        )}

        <Text style={styles.singleUseNote}>this invite is just for you — it can only be used once.</Text>

        {/* Primary action */}
        <Pressable
          style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.65 }]}
          onPress={handleJoin}
          disabled={status === 'joining'}
          accessibilityRole="button"
          accessibilityLabel="Join pshpsh"
        >
          {status === 'joining'
            ? <ActivityIndicator color={FG} size="small" />
            : <Text style={styles.joinTxt}>join pshpsh</Text>}
        </Pressable>

        {/* Already have an account */}
        <Pressable
          onPress={() => router.push('/(auth)/sign-in')}
          style={styles.secondaryBtn}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryTxt}>already a member? sign in</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
  },
  col: {
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    paddingHorizontal: 32,
  },

  // Portal header
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 160,
    height: 160,
  },
  wordmark: {
    fontFamily:    'Inter_700Bold',
    fontSize:      32,
    color:         FG,
    letterSpacing: -1,
    marginTop:     8,
    textAlign:     'center',
  },

  // Content
  headline: {
    fontFamily:    'Inter_700Bold',
    fontSize:      26,
    color:         FG,
    letterSpacing: -0.3,
    textAlign:     'center',
    marginBottom:  12,
  },
  sub: {
    fontFamily:   'Inter_400Regular',
    fontSize:     14,
    color:        MUTED,
    textAlign:    'center',
    lineHeight:   22,
    marginBottom: 12,
  },
  singleUseNote: {
    fontFamily:   'Inter_400Regular',
    fontSize:     12,
    color:        MUTED,
    textAlign:    'center',
    lineHeight:   18,
    opacity:      0.65,
    marginBottom: 16,
  },
  coPetPreview: {
    fontFamily:   'Inter_400Regular',
    fontSize:     13,
    color:        MUTED,
    textAlign:    'center',
    lineHeight:   20,
    marginBottom: 28,
    paddingHorizontal: 8,
  },

  // Actions
  joinBtn: {
    paddingVertical: 16,
    alignItems:      'center',
    marginBottom:    8,
  },
  joinTxt: {
    fontFamily: 'Inter_700Bold',
    fontSize:   17,
    color:      FG,
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems:      'center',
    marginTop:       8,
  },
  secondaryTxt: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    color:      MUTED,
    opacity:    0.7,
  },
});
