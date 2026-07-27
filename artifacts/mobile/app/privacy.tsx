/**
 * /privacy — Privacy Policy (tester draft).
 * Public page, portal visual system, phone-column.
 */

import React from 'react';
import { COLUMN_MAX_WIDTH } from '@/hooks/useColumnWidth';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BG    = '#060B10';
const FG    = '#F0F4F8';
const MUTED = '#6B7FA0';
const WARN  = '#8B7340';
const LOGO  = require('@/assets/icon.png');

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pt = insets.top + (Platform.OS === 'web' ? 24 : 48);
  const pb = insets.bottom + 48;

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[s.scroll, { paddingTop: pt, paddingBottom: pb }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.col}>

        {/* header */}
        <View style={s.header}>
          <Image source={LOGO} style={s.logo} resizeMode="contain" />
          <Text style={s.wordmark}>pshpsh</Text>
        </View>

        {/* tester draft notice */}
        <View style={s.draftBadge}>
          <Text style={s.draftText}>tester draft — pending legal review</Text>
        </View>

        <Text style={s.pageTitle}>privacy</Text>

        <Text style={s.body}>
          we collect only what pshpsh needs to work: your email and login (handled by our authentication provider), the pets and posts you create, and basic activity like boops and follows.
        </Text>
        <Text style={s.body}>
          your photos and content are stored securely. we don't sell your data. we don't run ads. we don't track you across the web.
        </Text>
        <Text style={s.body}>
          we use your email to send account and verification messages. that's it.
        </Text>
        <Text style={s.body}>
          you can request deletion of your account and its content — during testing, send feedback from your profile and we'll handle it.
        </Text>
        <Text style={s.body}>
          this is a tester draft. a complete privacy policy will be published before pshpsh opens to the public.
        </Text>

        {/* back whisper */}
        <Pressable
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(auth)/sign-in')}
          style={s.backBtn}
        >
          <Text style={s.backTxt}>← back</Text>
        </Pressable>

      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: BG },
  scroll: { flexGrow: 1, alignItems: 'center' },
  col: {
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    paddingHorizontal: 32,
    alignSelf: 'center',
  },

  header: { alignItems: 'center', marginBottom: 40 },
  logo:   { width: 48, height: 48, marginBottom: 10 },
  wordmark: {
    fontFamily:    'Inter_700Bold',
    fontSize:      20,
    color:         FG,
    letterSpacing: -0.3,
  },

  draftBadge: {
    borderWidth:   StyleSheet.hairlineWidth,
    borderColor:   WARN,
    borderRadius:  4,
    paddingVertical:   6,
    paddingHorizontal: 12,
    marginBottom:  24,
    alignSelf:     'flex-start',
  },
  draftText: {
    fontFamily:    'Inter_400Regular',
    fontSize:      11,
    color:         WARN,
    letterSpacing: 0.4,
  },

  pageTitle: {
    fontFamily:    'Inter_700Bold',
    fontSize:      22,
    color:         FG,
    letterSpacing: -0.3,
    marginBottom:  32,
  },

  body: {
    fontFamily:   'Inter_400Regular',
    fontSize:     15,
    color:        FG,
    lineHeight:   26,
    marginBottom: 20,
    opacity:      0.9,
  },

  backBtn: { marginTop: 48, alignItems: 'center', paddingVertical: 12 },
  backTxt: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    color:      MUTED,
    opacity:    0.7,
  },
});
