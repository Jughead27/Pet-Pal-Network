/**
 * /about — The pshpsh story.
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
          it started with a fish.
        </Text>
        <Text style={s.body}>
          his name was finn — a crowntail betta with fins like torn silk and, according to the one person who knew him, strong opinions about everything. finn lived on a desk. and the person at that desk noticed something: at the end of a long day spent scrolling through arguments, headlines, and people performing their best selves, the only thing on any screen that made him feel better was watching finn drift around being completely, magnificently unbothered.
        </Text>
        <Text style={s.body}>
          finn had no takes. finn was not building a personal brand. finn had never once been right about politics, because finn had never once thought about politics.
        </Text>
        <Text style={s.body}>
          so he built finn a social network. one user. it was called fish book, and it was, objectively, ridiculous.
        </Text>
        <Text style={s.body}>
          but it was also the only feed that ever made him feel the way animals make you feel: completely welcome, entirely off the hook. a pet doesn't care how the day scored you. you walk through the door and you are, immediately and without review, the best thing that has ever happened. no feed has ever loved anyone like that. so the ridiculous little site grew into a real one — built around that feeling, and renamed pshpsh: the sound you make when you're calling a cat over. soft, small, an invitation. that's still what it is.
        </Text>
        <Text style={s.body}>
          pshpsh runs on a few stubborn beliefs. the animals are the subject — humans may appear, but never the focus. followers belong to pets, not people, because your dog earned them and you know it. there are no trending topics, no news, no metrics to win. nothing here is urgent. nothing here is mad at you.
        </Text>
        <Text style={s.body}>
          finn is gone now, the way bettas go — briefly, and completely loved. but this whole place drifts in his wake.
        </Text>

        {/* closing three lines */}
        <Text style={s.closing}>come in. bring your animal.</Text>
        <Text style={s.closing}>follow pets, not people.</Text>
        <Text style={s.closing}>curl up, you're home.</Text>

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
