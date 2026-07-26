import React from 'react';
import { Platform, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@clerk/clerk-expo';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SniffIcon from '@/components/SniffIcon';
import HatchlingIcon from '@/components/HatchlingIcon';
import { useGetMe } from '@workspace/api-client-react';

// ─── TabLayout ────────────────────────────────────────────────────────────────
//
// Always uses the Classic (Tabs) layout so every tab renders its custom icon.
// The NativeTabs / liquid-glass path was removed: NativeTabs only supports SF
// symbols via <Icon>, so it cannot render SniffIcon or HatchlingIcon, causing
// Expo Go to show a compass (safari SF symbol) and a dove (bird SF symbol).

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
  const { isSignedIn, isLoaded } = useAuth();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const safeAreaInsets = useSafeAreaInsets();
  // Guard: only fire GET /me once Clerk has confirmed a live session.
  // Without `enabled`, the query fires during the initial render while
  // ClerkTokenSync's useEffect hasn't yet called setAuthTokenGetter — so the
  // first request has no Authorization header and returns 401.  Gating on
  // isLoaded && isSignedIn ensures the token getter is in place first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: meError } = useGetMe({ query: { enabled: isLoaded && isSignedIn === true } as any });

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
  // ────────────────────────────────────────────────────────────────────────

  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
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
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          marginBottom: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
        }}
      />

      {/* Sniff — always the custom sniffing-dog SVG, never an SF symbol */}
      <Tabs.Screen
        name="discovery"
        options={{
          title: 'Sniff',
          tabBarAccessibilityLabel: 'Sniff',
          tabBarIcon: ({ color }) => <SniffIcon size={22} color={color} />,
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
                <Feather name="plus" size={20} color={colors.background} />
              </View>
            </View>
          ),
        }}
      />

      {/* Nursery — always the custom hatchling SVG, never an SF symbol */}
      <Tabs.Screen
        name="nursery"
        options={{
          title: 'Nursery',
          tabBarIcon: ({ color }) => <HatchlingIcon size={22} color={color} />,
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
