import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppProvider } from '@/context/AppContext';
import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';

// Set the API base URL before any component renders.
//
// Why this is required on BOTH platforms:
//   Web  — the Expo preview runs on a separate Expo subdomain
//           (*.expo.kirk.replit.dev) while the /api proxy lives on the main
//           Replit dev domain (*.replit.dev).  Relative fetch URLs like
//           /api/feed resolve against the wrong origin and hit Metro, not the
//           API server — which explains the zero /api/* entries in server logs.
//   Native (Expo Go) — React Native fetch does not support relative URLs at
//           all; they must be absolute.
//
// EXPO_PUBLIC_DOMAIN is injected as $REPLIT_DEV_DOMAIN by the dev script,
// which is the domain where /api/* is proxied to port 8080.
if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// ─── SecureStore token cache (native only) ────────────────────────────────────
// On web, SecureStore is not available. Passing undefined lets Clerk fall back
// to its default in-memory / localStorage strategy on web.
const tokenCache =
  Platform.OS !== 'web'
    ? {
        getToken: (key: string) => SecureStore.getItemAsync(key),
        saveToken: (key: string, value: string) =>
          SecureStore.setItemAsync(key, value),
        clearToken: (key: string) => SecureStore.deleteItemAsync(key),
      }
    : undefined;

// ─── Clerk token → API client bridge ─────────────────────────────────────────
// Runs inside ClerkProvider so useAuth() is available.
// When signed in, registers a getter that supplies the Clerk JWT as the
// Authorization: Bearer token on every API request.
function ClerkTokenSync() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) {
      setAuthTokenGetter(null);
      return;
    }
    setAuthTokenGetter(() => getToken());
    return () => {
      setAuthTokenGetter(null);
    };
  }, [isSignedIn, getToken]);

  return null;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="pet/create"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="pet/[id]"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      tokenCache={tokenCache}
    >
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <AppProvider>
                  <ClerkTokenSync />
                  <RootLayoutNav />
                </AppProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
