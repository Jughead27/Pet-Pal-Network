/**
 * /guidelines — Community Guidelines.
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

export default function GuidelinesScreen() {
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

        <Text style={s.pageTitle}>community guidelines</Text>

        {/* anchor line — prominent */}
        <Text style={s.anchor}>humans may appear; animals must be the subject.</Text>

        <Text style={s.intro}>
          pshpsh is a home for animals. a few things keep it that way:
        </Text>

        <View style={s.rule}>
          <Text style={s.ruleHead}>post animals.</Text>
          <Text style={s.ruleBody}>
            pets are the point — every post should be about an animal. humans can be in the frame, but they're never the subject.
          </Text>
        </View>

        <View style={s.rule}>
          <Text style={s.ruleHead}>be kind.</Text>
          <Text style={s.ruleBody}>
            no harassment, no cruelty, no meanness — to people or to animals. content that depicts animal harm is removed immediately and is the thing we take most seriously.
          </Text>
        </View>

        <View style={s.rule}>
          <Text style={s.ruleHead}>keep it calm.</Text>
          <Text style={s.ruleBody}>
            no politics, no news cycles, no outrage. pshpsh is meant to be the quiet part of the internet.
          </Text>
        </View>

        <View style={s.rule}>
          <Text style={s.ruleHead}>label honestly.</Text>
          <Text style={s.ruleBody}>
            tag your pet's kind and breed as best you can, and use the nursery flag only for actual babies.
          </Text>
        </View>

        <View style={s.rule}>
          <Text style={s.ruleHead}>report what doesn't belong.</Text>
          <Text style={s.ruleBody}>
            if you see something off, use the report option — a real person reviews every report.
          </Text>
        </View>

        <Text style={s.closing}>
          that's it. bring your animal. be gentle. curl up.
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
    marginBottom:  24,
  },

  anchor: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      17,
    color:         FG,
    lineHeight:    26,
    letterSpacing: -0.2,
    marginBottom:  24,
  },

  intro: {
    fontFamily:   'Inter_400Regular',
    fontSize:     15,
    color:        FG,
    lineHeight:   24,
    opacity:      0.8,
    marginBottom: 32,
  },

  rule: { marginBottom: 28 },
  ruleHead: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      15,
    color:         FG,
    marginBottom:  6,
    letterSpacing: -0.1,
  },
  ruleBody: {
    fontFamily: 'Inter_400Regular',
    fontSize:   15,
    color:      FG,
    lineHeight: 24,
    opacity:    0.8,
  },

  closing: {
    fontFamily:   'Inter_400Regular',
    fontSize:     15,
    color:        FG,
    lineHeight:   26,
    opacity:      0.7,
    marginTop:    8,
    marginBottom: 8,
  },

  backBtn: { marginTop: 48, alignItems: 'center', paddingVertical: 12 },
  backTxt: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    color:      MUTED,
    opacity:    0.7,
  },
});
