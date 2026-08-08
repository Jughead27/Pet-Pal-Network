import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@clerk/clerk-expo';
import { House, Dog, BabyCarriage, User, Plus } from 'phosphor-react-native';
import { BlurView } from 'expo-blur';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGetMe, customFetch } from '@workspace/api-client-react';
import * as SecureStore from 'expo-secure-store';

// ─── portal palette (TOS gate uses same visual system) ───────────────────────
const TOS_BG    = '#060B10';
const TOS_FG    = '#F0F4F8';
const TOS_MUTED = '#6B7FA0';
const TOS_BORDER = '#182030';

// ─── TabLayout ────────────────────────────────────────────────────────────────
//
// Always uses the Classic (Tabs) layout so every tab renders its custom icon.

/** Returns true when an ApiError carries { error: "suspended" }. */
function isSuspendedError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { status?: number; data?: unknown };
  if (err.status !== 403) return false;
  const data = err.data as { error?: string } | null | undefined;
  return data?.error === 'suspended';
}

export default function TabLayout() {
  // All hooks must be called unconditionally before any early return.
  const { isSignedIn, isLoaded, signOut } = useAuth();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const safeAreaInsets = useSafeAreaInsets();
  const router = useRouter();

  // TOS gate local state — set to true after successful acceptance so the gate
  // clears immediately without waiting for a /me refetch.
  const [tosAccepted, setTosAccepted] = useState(false);
  const [tosAccepting, setTosAccepting] = useState(false);

  // Co-ownership confirm — shown after invite redemption when the inviter
  // pre-selected pets to share with the new user.
  const [pendingCoPets, setPendingCoPets] = useState<{
    code:            string;
    coPets:          Array<{ id: string; name: string; species: string | null }>;
    inviterUsername: string | null;
  } | null>(null);
  const [coPetsAccepting, setCoPetsAccepting] = useState(false);

  // Guard: only fire GET /me once Clerk has confirmed a live session.
  // Without `enabled`, the query fires during the initial render while
  // ClerkTokenSync's useEffect hasn't yet called setAuthTokenGetter — so the
  // first request has no Authorization header and returns 401.  Gating on
  // isLoaded && isSignedIn ensures the token getter is in place first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: meData, error: meError } = useGetMe({ query: { enabled: isLoaded && isSignedIn === true } as any });

  // Redeem any pending invite code that survived the OAuth round-trip.
  // This handles both: (a) password signup where code was set but session activated async,
  // and (b) Google OAuth where the browser round-trip clears React state but not SecureStore.
  useEffect(() => {
    if (!isSignedIn) return;
    (async () => {
      let savedCode: string | null = null;
      try {
        savedCode = await SecureStore.getItemAsync('pendingInviteCode');
        if (!savedCode) return;
        // Best-effort — if expired/already used, endpoint returns ok:false (no throw).
        const result = await customFetch<{
          ok:              boolean;
          coPets?:         Array<{ id: string; name: string; species: string | null }>;
          inviterUsername?: string | null;
        }>('/api/invites/redeem', {
          method: 'POST',
          body:   JSON.stringify({ code: savedCode }),
        });
        // If the invite carried co-pet grants, prompt the new user to accept.
        if (result.ok && result.coPets?.length && savedCode) {
          setPendingCoPets({
            code:            savedCode,
            coPets:          result.coPets,
            inviterUsername: result.inviterUsername ?? null,
          });
        }
      } catch { /* silent — invite attribution is best-effort */ } finally {
        await SecureStore.deleteItemAsync('pendingInviteCode').catch(() => {});
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // ─── Auth guard (after all hooks) ───────────────────────────────────────
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  // ─── Suspension gate ─────────────────────────────────────────────────────
  // When the server returns 403 { error: "suspended" }, show a plain full-screen
  // notice. Every subsequent API call will also fail — this screen is final until
  // an admin lifts the suspension.
  if (isSuspendedError(meError)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 18, color: colors.foreground, textAlign: 'center', lineHeight: 28 }}>
          this account is suspended.
        </Text>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.mutedForeground, textAlign: 'center', marginTop: 12, lineHeight: 22 }}>
          if you believe this is a mistake, contact support.
        </Text>
      </View>
    );
  }

  // ─── ToS acceptance gate ─────────────────────────────────────────────────
  // Show once after sign-in when the user has not yet accepted the current
  // version. tosAccepted is a local flag that clears the gate immediately
  // after the API call succeeds, without waiting for a /me refetch.
  // The user can always sign out — they are never trapped.
  const me = meData as (typeof meData & { acceptedTosVersion?: string | null; tosCurrentVersion?: string }) | undefined;
  // Gate disabled until reviewed legal copy is published — reactivate via version bump.
  const tosRequired = false;

  if (tosRequired) {
    const pt = safeAreaInsets.top + (Platform.OS === 'web' ? 24 : 48);
    const pb = safeAreaInsets.bottom + 40;

    const handleAccept = async () => {
      setTosAccepting(true);
      try {
        await customFetch('/api/tos/accept', { method: 'POST' });
        setTosAccepted(true);
      } catch {
        // retry is safe — endpoint is idempotent
      } finally {
        setTosAccepting(false);
      }
    };

    return (
      <ScrollView
        style={gt.root}
        contentContainerStyle={[gt.scroll, { paddingTop: pt, paddingBottom: pb }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={gt.col}>
          {/* wordmark */}
          <Text style={gt.wordmark}>pshpsh</Text>

          {/* headline */}
          <Text style={gt.headline}>before you continue.</Text>

          {/* plain-language summary */}
          <Text style={gt.body}>
            pshpsh is an invite-only test. by continuing, you agree to post animal content, treat members with kindness, and follow the community guidelines.
          </Text>
          <Text style={gt.body}>
            we collect only what the app needs to work — your login, pets, posts, and basic activity. we don't sell your data or run ads.
          </Text>

          {/* links */}
          <View style={gt.linkRow}>
            <Pressable onPress={() => router.push('/terms')} hitSlop={8}>
              <Text style={gt.link}>terms</Text>
            </Pressable>
            <Text style={gt.linkDot}> · </Text>
            <Pressable onPress={() => router.push('/privacy')} hitSlop={8}>
              <Text style={gt.link}>privacy</Text>
            </Pressable>
            <Text style={gt.linkDot}> · </Text>
            <Pressable onPress={() => router.push('/guidelines')} hitSlop={8}>
              <Text style={gt.link}>guidelines</Text>
            </Pressable>
          </View>

          {/* agree & continue */}
          <Pressable
            style={({ pressed }) => [gt.agreeBtn, pressed && gt.dimmed, tosAccepting && gt.disabled]}
            onPress={handleAccept}
            disabled={tosAccepting}
          >
            {tosAccepting
              ? <ActivityIndicator color={TOS_FG} size="small" />
              : <Text style={gt.agreeTxt}>agree & continue</Text>}
          </Pressable>

          {/* sign-out escape hatch */}
          <Pressable
            style={gt.signOutBtn}
            onPress={() => signOut()}
            hitSlop={8}
          >
            <Text style={gt.signOutTxt}>sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: 'absolute',
          // iOS: transparent so BlurView shows through.
          // Web: transparent so the tabBarBackground blur layer shows through.
          // Android: solid app background (no blur support without extra lib).
          backgroundColor: (isIOS || isWeb) ? 'transparent' : colors.background,
          borderTopWidth: isWeb ? 1 : StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          // On web: env(safe-area-inset-bottom) accounts for the iOS Safari browser
          // chrome that overlaps the bottom of the viewport. Without it, icons and
          // labels are clipped. viewport-fit=cover (set in app.json) is required
          // for env() to return a non-zero value on Mobile Safari.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          paddingBottom: isWeb ? ('env(safe-area-inset-bottom)' as any) : safeAreaInsets.bottom,
          // overflow: visible lets the Add circle bleed above the bar on both
          // web (CSS overflow) and native (RN overflow). Without this the circle
          // is hard-clipped at the bar's top edge.
          overflow: 'visible',
          // Web: minHeight instead of fixed height so the bar grows with the safe-
          // area padding. Native: no explicit height (React Navigation default).
          ...(isWeb ? { minHeight: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            // iOS: native frosted-glass blur via expo-blur
            <BlurView
              intensity={90}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            // Web: semi-transparent background + CSS backdrop-filter blur so
            // content scrolling behind the bar shows through — matching iOS visually.
            // backdropFilter is a React Native Web style extension (not in RN ViewStyle
            // types) so we cast to any.
            <View
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(6,11,16,0.75)', backdropFilter: 'blur(20px)' } as any]}
            />
          ) : null,
        tabBarItemStyle: {
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          marginTop: 2,
          marginBottom: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <House color={color} weight={focused ? 'fill' : 'light'} size={26} />
          ),
        }}
      />

      <Tabs.Screen
        name="discovery"
        options={{
          title: 'Sniff',
          tabBarAccessibilityLabel: 'Sniff',
          tabBarIcon: ({ color, focused }) => (
            <Dog color={color} weight={focused ? 'fill' : 'light'} size={26} />
          ),
        }}
      />

      <Tabs.Screen
        name="add"
        options={{
          title: 'Add',
          tabBarIcon: () => (
            // Touch target: 48×48 (≥44 required), centered on the circle.
            // marginTop: -22 lifts the whole block so ~9px of the 40px circle
            // bleeds above the nav bar's top edge.  The label stays at its
            // natural baseline because tabBarLabel is rendered separately by
            // React Navigation — only the icon wrapper moves.
            <View
              style={{
                width: 48,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: -22,
                // Allow the circle to paint outside this wrapper on web
                overflow: 'visible',
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: colors.foreground,
                  alignItems: 'center',
                  justifyContent: 'center',
                  // iOS / macOS shadow
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.25,
                  shadowRadius: 8,
                  // Android elevation (also provides shadow on API 21+)
                  elevation: 8,
                  // React Native Web box-shadow
                  ...(isWeb ? { boxShadow: '0 2px 8px rgba(0,0,0,0.25)' } : {}),
                  // Sit above media canvas and any scrims
                  zIndex: 20,
                }}
              >
                <Plus size={20} color={colors.background} weight="light" />
              </View>
            </View>
          ),
        }}
      />

      <Tabs.Screen
        name="nursery"
        options={{
          title: 'Nursery',
          tabBarIcon: ({ color, focused }) => (
            <BabyCarriage color={color} weight={focused ? 'fill' : 'light'} size={26} />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <User color={color} weight={focused ? 'fill' : 'light'} size={26} />
          ),
        }}
      />
    </Tabs>

    {/* Co-ownership confirm overlay — surfaces after invite redemption */}
    <Modal visible={pendingCoPets !== null} transparent animationType="fade">
      <View style={gt.coPetsOverlay}>
        <View style={gt.coPetsSheet}>
          <Text style={gt.coPetsTitle}>they added you as a co-owner</Text>
          <Text style={gt.coPetsBody}>
            {pendingCoPets?.coPets.map((p) => p.name).join(', ')}
          </Text>
          <Text style={gt.coPetsSub}>
            accept, and you'll both be able to post{' '}
            {(pendingCoPets?.coPets.length ?? 0) > 1 ? 'their' : 'this pet\u2019s'} photos and updates.
          </Text>
          <Pressable
            style={({ pressed }) => [
              gt.agreeBtn,
              { marginBottom: 8 },
              pressed && gt.dimmed,
              coPetsAccepting && gt.disabled,
            ]}
            disabled={coPetsAccepting}
            onPress={async () => {
              if (!pendingCoPets || coPetsAccepting) return;
              setCoPetsAccepting(true);
              try {
                await customFetch('/api/invites/accept-co-pets', {
                  method: 'POST',
                  body: JSON.stringify({ code: pendingCoPets.code }),
                });
              } catch { /* silent */ } finally {
                setCoPetsAccepting(false);
                setPendingCoPets(null);
              }
            }}
          >
            {coPetsAccepting
              ? <ActivityIndicator color={TOS_FG} size="small" />
              : <Text style={gt.agreeTxt}>accept</Text>}
          </Pressable>
          <Pressable
            style={({ pressed }) => [gt.signOutBtn, pressed && gt.dimmed]}
            onPress={() => setPendingCoPets(null)}
          >
            <Text style={gt.signOutTxt}>no thanks</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    </View>
  );
}

// ─── TOS gate styles (portal palette) ────────────────────────────────────────
const gt = StyleSheet.create({
  root:  { flex: 1, backgroundColor: TOS_BG },
  scroll: { flexGrow: 1, alignItems: 'center' },
  col: {
    width: '100%',
    maxWidth: 430,
    paddingHorizontal: 32,
    alignSelf: 'center',
  },

  wordmark: {
    fontFamily:    'Inter_700Bold',
    fontSize:      20,
    color:         TOS_FG,
    letterSpacing: -0.3,
    marginBottom:  48,
  },

  headline: {
    fontFamily:    'Inter_700Bold',
    fontSize:      26,
    color:         TOS_FG,
    letterSpacing: -0.3,
    marginBottom:  28,
  },

  body: {
    fontFamily:   'Inter_400Regular',
    fontSize:     15,
    color:        TOS_FG,
    lineHeight:   26,
    opacity:      0.85,
    marginBottom: 18,
  },

  linkRow: {
    flexDirection:  'row',
    alignItems:     'center',
    marginTop:      8,
    marginBottom:   48,
  },
  link: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    color:      TOS_MUTED,
  },
  linkDot: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    color:      TOS_MUTED,
    opacity:    0.4,
  },

  agreeBtn: {
    borderWidth:     StyleSheet.hairlineWidth,
    borderColor:     TOS_FG,
    paddingVertical: 16,
    alignItems:      'center',
    marginBottom:    16,
  },
  agreeTxt: {
    fontFamily: 'Inter_700Bold',
    fontSize:   17,
    color:      TOS_FG,
  },

  signOutBtn: {
    paddingVertical: 14,
    alignItems:      'center',
  },
  signOutTxt: {
    fontFamily: 'Inter_400Regular',
    fontSize:   13,
    color:      TOS_MUTED,
    opacity:    0.6,
  },

  dimmed:   { opacity: 0.65 },
  disabled: { opacity: 0.35 },

  // Co-ownership confirm modal (post-invite-redemption)
  coPetsOverlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent:  'center',
    alignItems:      'center',
    padding:         32,
  },
  coPetsSheet: {
    width:           '100%',
    maxWidth:        400,
    backgroundColor: TOS_BG,
    borderWidth:     StyleSheet.hairlineWidth,
    borderColor:     TOS_BORDER,
    borderRadius:    20,
    padding:         28,
  },
  coPetsTitle: {
    fontFamily:    'Inter_700Bold',
    fontSize:      20,
    color:         TOS_FG,
    letterSpacing: -0.3,
    marginBottom:  10,
    textAlign:     'center',
  },
  coPetsBody: {
    fontFamily:   'Inter_600SemiBold',
    fontSize:     16,
    color:        TOS_FG,
    textAlign:    'center',
    marginBottom: 6,
  },
  coPetsSub: {
    fontFamily:   'Inter_400Regular',
    fontSize:     14,
    color:        TOS_MUTED,
    textAlign:    'center',
    marginBottom: 28,
    lineHeight:   22,
  },
});
