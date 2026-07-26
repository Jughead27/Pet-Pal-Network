import React, { useCallback, useState } from 'react';
import { COLUMN_MAX_WIDTH } from '@/hooks/useColumnWidth';
import {
  ActivityIndicator,
  Image,
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

// Required for OAuth redirect to complete inside Expo Go.
WebBrowser.maybeCompleteAuthSession();

const LOGO = require('@/assets/icon.png');

// ── Design tokens (portal palette) ────────────────────────────────────────────
const BG          = '#060B10';
const FG          = '#F0F4F8';
const MUTED       = '#6B7FA0';
const BORDER      = '#182030';
const DESTRUCTIVE = '#FF4444';

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();

  const { signUp, setActive, isLoaded } = useSignUp();
  const { signIn } = useSignIn(); // needed for Google → existing-user transfer
  const { startSSOFlow } = useSSO();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode]         = useState('');

  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // ── Helper ────────────────────────────────────────────────────────────────
  function clerkMessage(err: unknown): string {
    const e = err as { errors?: { longMessage?: string; message?: string }[] };
    return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? 'an error occurred. please try again.';
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
        setError(`verification returned status "${result.status}". please try again.`);
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
        if (!signIn) { setError('sign-in unavailable. please try again.'); return; }
        const si = await signIn.create({ transfer: true });
        if (si.status === 'complete' && ssoSetActive) {
          await ssoSetActive({ session: si.createdSessionId! });
        } else if (si.status !== 'complete') {
          setError(`google sign-in returned status "${si.status}".`);
        }

      } else if (!createdSessionId) {
        setError('google sign-in could not be completed. please try again.');
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setSsoLoading(false);
    }
  }, [startSSOFlow, signIn]);

  // ── Verification step ─────────────────────────────────────────────────────
  if (pendingVerification) {
    return (
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.col}>
            {/* ── Portal header ── */}
            <View style={s.header}>
              <Image source={LOGO} style={s.logo} resizeMode="contain" />
              <Text style={s.wordmark}>pshpsh</Text>
              <View style={s.sloganWrap}>
                <Text style={s.slogan1}>check your email.</Text>
              </View>
            </View>

            <Text style={s.recipientLine}>
              we sent a verification code to{'\n'}
              <Text style={{ color: FG }}>{email}</Text>
            </Text>
            <Text style={s.spamHint}>not seeing it? check your spam folder</Text>

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>verification code</Text>
              <TextInput
                style={s.underlineInput}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                placeholderTextColor={MUTED}
                placeholder="6-digit code"
                selectionColor={FG}
                onSubmitEditing={handleVerify}
                returnKeyType="go"
                autoFocus
              />
            </View>

            {error ? <Text style={s.errorText}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                s.primaryAction, pressed && s.dimmed, (verifying || code.length < 6) && s.disabled,
              ]}
              onPress={handleVerify}
              disabled={verifying || code.length < 6}
            >
              {verifying
                ? <ActivityIndicator color={FG} size="small" />
                : <Text style={s.primaryActionText}>verify email</Text>}
            </Pressable>

            <View style={s.whisperRow}>
              <Pressable onPress={() => { setPendingVerification(false); setError(null); }}>
                <Text style={s.whisper}>← back</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Registration step ─────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.col}>
          {/* ── Portal header ── */}
          <View style={s.header}>
            <Image source={LOGO} style={s.logo} resizeMode="contain" />
            <Text style={s.wordmark}>pshpsh</Text>
            <View style={s.sloganWrap}>
              <Text style={s.slogan1}>follow pets, not people.</Text>
              <Text style={s.slogan2}>curl up, you're home.</Text>
            </View>
          </View>

          {/* ── Email field ── */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>email</Text>
            <TextInput
              style={s.underlineInput}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholderTextColor={MUTED}
              placeholder="you@example.com"
              selectionColor={FG}
            />
          </View>

          {/* ── Password field ── */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>password</Text>
            <TextInput
              style={s.underlineInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              placeholderTextColor={MUTED}
              placeholder="8+ characters"
              selectionColor={FG}
              onSubmitEditing={handleSignUp}
              returnKeyType="go"
            />
          </View>

          {error ? <Text style={s.errorText}>{error}</Text> : null}

          {/* ── Primary action ── */}
          <Pressable
            style={({ pressed }) => [
              s.primaryAction, pressed && s.dimmed, (loading || !email || password.length < 8) && s.disabled,
            ]}
            onPress={handleSignUp}
            disabled={loading || !email || password.length < 8}
          >
            {loading
              ? <ActivityIndicator color={FG} size="small" />
              : <Text style={s.primaryActionText}>create account</Text>}
          </Pressable>

          {/* ── Google SSO ── */}
          <Pressable
            style={({ pressed }) => [s.secondaryAction, pressed && s.dimmed]}
            onPress={handleGoogle}
            disabled={ssoLoading}
          >
            {ssoLoading
              ? <ActivityIndicator color={MUTED} size="small" />
              : <Text style={s.secondaryActionText}>continue with google</Text>}
          </Pressable>

          {/* ── Switch to sign-in ── */}
          <View style={s.switchRow}>
            <Text style={s.switchText}>already have an account? </Text>
            <Pressable onPress={() => router.push('/(auth)/sign-in')}>
              <Text style={s.switchLink}>sign in</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
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

  // ── Portal header ──────────────────────────────────────────────────────────
  header: {
    alignItems: 'center',
    marginBottom: 56,
  },
  logo: {
    width: 200,
    height: 200,
  },
  wordmark: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    color: FG,
    letterSpacing: -1,
    marginTop: 8,
    textAlign: 'center',
  },
  sloganWrap: {
    alignItems: 'center',
    marginTop: 16,
    gap: 6,
  },
  slogan1: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: FG,
    opacity: 0.72,
    textAlign: 'center',
    lineHeight: 22,
  },
  slogan2: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Form fields ───────────────────────────────────────────────────────────
  fieldGroup: {
    marginBottom: 28,
  },
  fieldLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: MUTED,
    letterSpacing: 0.7,
    marginBottom: 10,
  },
  underlineInput: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: FG,
    paddingVertical: 10,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },

  // ── Recipients / sub-headings ─────────────────────────────────────────────
  recipientLine: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 6,
  },
  spamHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: MUTED,
    opacity: 0.55,
    textAlign: 'center',
    marginBottom: 36,
  },

  // ── Error ─────────────────────────────────────────────────────────────────
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: DESTRUCTIVE,
    marginBottom: 16,
    lineHeight: 19,
  },

  // ── Actions ───────────────────────────────────────────────────────────────
  primaryAction: {
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryActionText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    color: FG,
    textAlign: 'center',
  },
  disabled: { opacity: 0.35 },
  dimmed:   { opacity: 0.65 },

  secondaryAction: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryActionText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
  },

  // ── Whispers ──────────────────────────────────────────────────────────────
  whisperRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 28,
  },
  whisper: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: MUTED,
    opacity: 0.7,
  },

  // ── Switch row (bottom) ───────────────────────────────────────────────────
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 48,
  },
  switchText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
    opacity: 0.7,
  },
  switchLink: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
  },
});
