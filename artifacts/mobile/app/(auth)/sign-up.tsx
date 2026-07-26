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
import { useSignIn, useSignUp, useSSO } from '@clerk/clerk-expo';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

// Required for OAuth redirect to complete inside Expo Go.
WebBrowser.maybeCompleteAuthSession();

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { signUp, setActive, isLoaded } = useSignUp();
  const { signIn } = useSignIn(); // needed for Google → existing-user transfer
  const { startSSOFlow } = useSSO();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');

  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Helper ────────────────────────────────────────────────────────────────
  function clerkMessage(err: unknown): string {
    const e = err as { errors?: { longMessage?: string; message?: string }[] };
    return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? 'An error occurred. Please try again.';
  }

  // ── Step 1: Create account ────────────────────────────────────────────────
  const handleSignUp = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      await signUp!.create({
        emailAddress: email.trim(),
        password,
      });
      await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signUp, email, password]);

  // ── Step 2: Verify email OTP ──────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (!isLoaded) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await signUp!.attemptEmailAddressVerification({ code });
      if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId });
      } else {
        setError(`Verification returned status "${result.status}". Please try again.`);
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setVerifying(false);
    }
  }, [isLoaded, signUp, code, setActive]);

  // ── Google SSO ────────────────────────────────────────────────────────────
  const handleGoogle = useCallback(async () => {
    setSsoLoading(true);
    setError(null);
    try {
      const result = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: Linking.createURL('/sso-callback'),
      });
      const { createdSessionId, setActive: ssoSetActive, signUp: ssoSignUp } = result;

      if (createdSessionId && ssoSetActive) {
        // New Google user — signed up directly.
        await ssoSetActive({ session: createdSessionId });

      } else if (ssoSignUp?.verifications?.externalAccount?.status === 'transferable') {
        // Existing Google user arriving at sign-up — transfer to sign-in.
        if (!signIn) { setError('Sign-in unavailable. Please try again.'); return; }
        const si = await signIn.create({ transfer: true });
        if (si.status === 'complete' && ssoSetActive) {
          await ssoSetActive({ session: si.createdSessionId! });
        } else if (si.status !== 'complete') {
          setError(`Google sign-in returned status "${si.status}".`);
        }

      } else if (!createdSessionId) {
        setError('Google sign-in could not be completed. Please try again.');
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setSsoLoading(false);
    }
  }, [startSSOFlow, signIn]);

  const s = makeStyles(colors);

  // ── Verification step ─────────────────────────────────────────────────────
  if (pendingVerification) {
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
          <Text style={s.wordmark}>pshpsh</Text>
          <Text style={s.tagline}>Check your email</Text>
          <Text style={s.verifySubtitle}>
            We sent a verification code to{'\n'}
            <Text style={{ color: colors.foreground }}>{email}</Text>
          </Text>

          <View style={s.card}>
            <Text style={s.label}>Verification Code</Text>
            <TextInput
              style={s.input}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholderTextColor={colors.mutedForeground}
              placeholder="6-digit code"
              selectionColor={colors.primary}
              onSubmitEditing={handleVerify}
              returnKeyType="go"
              autoFocus
            />

            {error ? <Text style={s.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                s.primaryBtn,
                pressed && s.pressed,
                (verifying || code.length < 6) && s.btnDisabled,
              ]}
              onPress={handleVerify}
              disabled={verifying || code.length < 6}
            >
              {verifying ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={s.primaryBtnText}>Verify Email</Text>
              )}
            </Pressable>
          </View>

          <View style={s.switchRow}>
            <Pressable onPress={() => { setPendingVerification(false); setError(null); }}>
              <Text style={s.switchLink}>← Back</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Registration step ─────────────────────────────────────────────────────
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
        <Text style={s.wordmark}>pshpsh</Text>
        <Text style={s.tagline}>Create your account</Text>

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
            textContentType="newPassword"
            placeholderTextColor={colors.mutedForeground}
            placeholder="8+ characters"
            selectionColor={colors.primary}
            onSubmitEditing={handleSignUp}
            returnKeyType="go"
          />

          {/* Error */}
          {error ? <Text style={s.error}>{error}</Text> : null}

          {/* Primary button */}
          <Pressable
            style={({ pressed }) => [
              s.primaryBtn,
              pressed && s.pressed,
              (loading || !email || password.length < 8) && s.btnDisabled,
            ]}
            onPress={handleSignUp}
            disabled={loading || !email || password.length < 8}
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={s.primaryBtnText}>Create Account</Text>
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

        {/* Switch to sign-in */}
        <View style={s.switchRow}>
          <Text style={s.switchText}>Already have an account? </Text>
          <Pressable onPress={() => router.push('/(auth)/sign-in')}>
            <Text style={s.switchLink}>Sign in</Text>
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
    verifySubtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: c.mutedForeground,
      textAlign: 'center',
      lineHeight: 22,
      marginTop: -28,
      marginBottom: 32,
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
    btnDisabled: { opacity: 0.5 },

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
