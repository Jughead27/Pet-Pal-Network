import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSignIn, useSSO } from '@clerk/clerk-expo';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

// Required for OAuth redirect to complete inside Expo Go.
WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { signIn, setActive, isLoaded } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Email + password sign-in ────────────────────────────────────────────
  const handleSignIn = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
      } else {
        setError('Sign-in could not be completed. Please try again.');
      }
    } catch (err: unknown) {
      const msg =
        (err as { errors?: { message: string }[] })?.errors?.[0]?.message ??
        'An error occurred. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, email, password, setActive]);

  // ─── Google SSO ──────────────────────────────────────────────────────────
  const handleGoogle = useCallback(async () => {
    setSsoLoading(true);
    setError(null);
    try {
      const redirectUrl = Linking.createURL('/');
      const { createdSessionId, setActive: ssoSetActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl,
      });
      if (createdSessionId && ssoSetActive) {
        await ssoSetActive({ session: createdSessionId });
      }
    } catch (err: unknown) {
      const msg =
        (err as { errors?: { message: string }[] })?.errors?.[0]?.message ??
        'Google sign-in failed. Ensure Google is enabled in your Clerk dashboard.';
      setError(msg);
    } finally {
      setSsoLoading(false);
    }
  }, [startSSOFlow]);

  const s = makeStyles(colors);

  return (
    <KeyboardAvoidingView
      style={[s.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Wordmark */}
        <Text style={s.wordmark}>Fish Book</Text>
        <Text style={s.tagline}>Sign in to continue</Text>

        {/* Form card */}
        <View style={s.card}>
          {/* Email */}
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholderTextColor={colors.mutedForeground}
            placeholder="you@example.com"
            selectionColor={colors.primary}
          />

          {/* Password */}
          <Text style={[s.label, { marginTop: 16 }]}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            placeholderTextColor={colors.mutedForeground}
            placeholder="••••••••"
            selectionColor={colors.primary}
            onSubmitEditing={handleSignIn}
            returnKeyType="go"
          />

          {/* Error */}
          {error ? <Text style={s.error}>{error}</Text> : null}

          {/* Primary button */}
          <Pressable
            style={({ pressed }) => [s.primaryBtn, pressed && s.pressed]}
            onPress={handleSignIn}
            disabled={loading || !email || !password}
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={s.primaryBtnText}>Sign In</Text>
            )}
          </Pressable>

          {/* Divider */}
          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          {/* Google */}
          <Pressable
            style={({ pressed }) => [s.secondaryBtn, pressed && s.pressed]}
            onPress={handleGoogle}
            disabled={ssoLoading}
          >
            {ssoLoading ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <Text style={s.secondaryBtnText}>Continue with Google</Text>
            )}
          </Pressable>
        </View>

        {/* Switch to sign-up */}
        <View style={s.switchRow}>
          <Text style={s.switchText}>Don't have an account? </Text>
          <Pressable onPress={() => router.push('/(auth)/sign-up')}>
            <Text style={s.switchLink}>Create one</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStyles(c: ReturnType<typeof useColors>): Record<string, any> {
  return StyleSheet.create({
    flex: { flex: 1 },
    scroll: { flexGrow: 1, paddingHorizontal: 24 },

    wordmark: {
      fontFamily: 'Inter_700Bold',
      fontSize: 28,
      color: c.foreground,
      textAlign: 'center',
      letterSpacing: -0.5,
    },
    tagline: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: c.mutedForeground,
      textAlign: 'center',
      marginTop: 6,
      marginBottom: 40,
    },

    card: {
      backgroundColor: c.card,
      borderRadius: c.radius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 24,
    },

    label: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: c.mutedForeground,
      marginBottom: 8,
      letterSpacing: 0.2,
    },
    input: {
      backgroundColor: c.secondary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: c.radius - 4,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === 'ios' ? 13 : 10,
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: c.foreground,
    },
    error: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: c.destructive,
      marginTop: 12,
    },

    primaryBtn: {
      backgroundColor: c.primary,
      borderRadius: c.radius - 4,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 24,
    },
    primaryBtnText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
      color: c.primaryForeground,
    },

    pressed: { opacity: 0.75 },

    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginVertical: 20,
      gap: 12,
    },
    dividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    dividerText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: c.mutedForeground,
    },

    secondaryBtn: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      borderRadius: c.radius - 4,
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: c.secondary,
    },
    secondaryBtnText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      color: c.foreground,
    },

    switchRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 32,
    },
    switchText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: c.mutedForeground,
    },
    switchLink: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      color: c.primary,
    },
  });
}
