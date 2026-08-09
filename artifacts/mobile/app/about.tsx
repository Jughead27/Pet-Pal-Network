/**
 * /about — The pshpsh story.
 * Public page, portal visual system, phone-column.
 */

import React from 'react';
import { COLUMN_MAX_WIDTH } from '@/hooks/useColumnWidth';
import {
  Image,
  Linking,
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
const LOGO  = require('@/assets/icon.png');

export default function AboutScreen() {
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

        {/* title */}
        <Text style={s.pageTitle}>about pshpsh</Text>

        {/* body */}
        <Text style={s.body}>
          it started with two kittens.
        </Text>
        <Text style={s.body}>
          a month before the world shut down, we adopted two bonded calicos from a rescue — newt and ripley. i'd had dogs my whole childhood, never cats. they were younger than most orgs like to place. we took them anyway.
        </Text>
        <Text style={s.body}>
          four weeks later, everything closed. no office, no plans, nobody but each other — and two kittens who had absolutely no idea what was happening and did not care. they didn't know about lockdowns, or the news, or any of it. they just wanted to be fed, and held, and to sit in a sunny window. it turned out that was exactly what we needed too.
        </Text>
        <Text style={s.body}>
          they weren't our first pet. a few years earlier there was finn, a betta who lived on a desk and had, by all accounts, strong opinions about everything — the whole reason this site was almost called fish book. but newt and ripley are the ones who showed us something we didn't expect: that a pet can be the one part of your day that has nothing to do with any of it. no arguments, no headlines, no one performing. just an animal, glad you're home.
        </Text>
        <Text style={s.body}>
          that's the whole idea behind pshpsh. the world outside is loud enough already. this is meant to be the quiet room next door — a feed with no politics, no metrics, no one keeping score. just pets, being pets, and the people who love them.
        </Text>

        {/* closing three lines */}
        <Text style={s.closing}>come in. bring your animal.</Text>
        <Text style={s.closing}>curl up, you're home.</Text>
        <Text style={s.closing}>follow pets, not people.</Text>

        {/* support contact */}
        <Text style={s.body}>
          need a human? email{' '}
          <Text
            style={s.emailLink}
            onPress={() => Linking.openURL('mailto:support@pshpsh.net')}
            accessibilityRole="link"
          >
            support@pshpsh.net
          </Text>
          .
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

  pageTitle: {
    fontFamily:    'Inter_700Bold',
    fontSize:      22,
    color:         FG,
    letterSpacing: -0.3,
    marginBottom:  32,
  },

  emailLink: {
    textDecorationLine: 'underline',
  },
  body: {
    fontFamily:   'Inter_400Regular',
    fontSize:     15,
    color:        FG,
    lineHeight:   26,
    marginBottom: 20,
    opacity:      0.9,
  },

  closing: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      15,
    color:         FG,
    lineHeight:    28,
    letterSpacing: -0.1,
  },

  backBtn: { marginTop: 48, alignItems: 'center', paddingVertical: 12 },
  backTxt: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    color:      MUTED,
    opacity:    0.7,
  },
});
