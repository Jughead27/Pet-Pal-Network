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

type Step =
  | 'credentials'   // normal email + password
  | 'resetEmail'    // forgot-password: enter email
  | 'resetCode'     // forgot-password: enter code + new password
  | 'secondFactor'; // device / client-trust: enter emailed code

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { signIn, setActive, isLoaded } = useSignIn();
  const { signUp } = useSignUp(); // needed for Google → new-user transfer
  const { startSSOFlow } = useSSO();

  const [step, setStep] = useState<Step>('credentials');

  // ── Credentials step ──────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // ── Second-factor step ────────────────────────────────────────────────────
  const [sfCode, setSfCode] = useState('');
  const [sfSending, setSfSending] = useState(false);
  const [sfEmail, setSfEmail] = useState(''); // display-only safe identifier

  // ── Forgot-password steps ─────────────────────────────────────────────────
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // ── Shared ────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function clerkMessage(err: unknown): string {
    const e = err as { errors?: { longMessage?: string; message?: string }[] };
    return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? 'An error occurred. Please try again.';
  }

  // ── Email + password sign-in ──────────────────────────────────────────────
  const handleSignIn = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const result = await signIn!.create({
        identifier: email.trim(),
        password,
      });

      if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId });

      } else if (result.status === 'needs_second_factor') {
        // Item 7: device verification / client-trust email-code flow.
        const emailCodeFactor = (
          result.supportedSecondFactors as Array<{ strategy: string; safeIdentifier?: string }> | undefined
        )?.find(f => f.strategy === 'email_code');

        if (!emailCodeFactor) {
          // Unsupported strategy — surface it honestly (item 4).
          const strategies = (result.supportedSecondFactors as Array<{ strategy: string }> | undefined)
            ?.map(f => f.strategy).join(', ') ?? 'unknown';
          setError(`Additional verification required (${strategies}). Contact support.`);
          return;
        }

        // Auto-send the code.
        setSfEmail(emailCodeFactor.safeIdentifier ?? email.trim());
        setSfSending(true);
        await signIn!.prepareSecondFactor({ strategy: 'email_code' });
        setSfSending(false);
        setStep('secondFactor');

      } else {
        // Any other non-complete status — never silently swallow it.
        setError(`Sign-in returned status "${result.status}". Check your Clerk dashboard configuration.`);
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setLoading(false);
      setSfSending(false);
    }
  }, [isLoaded, signIn, email, password, setActive]);

  // ── Second-factor: attempt ────────────────────────────────────────────────
  const handleSecondFactor = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const result = await signIn!.attemptSecondFactor({
        strategy: 'email_code',
        code: sfCode.trim(),
      });
      if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId });
      } else {
        setError(`Verification returned status "${result.status}". Please try again.`);
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, sfCode, setActive]);

  // ── Second-factor: resend ─────────────────────────────────────────────────
  const handleResendCode = useCallback(async () => {
    if (!isLoaded) return;
    setError(null);
    setSfSending(true);
    try {
      await signIn!.prepareSecondFactor({ strategy: 'email_code' });
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setSfSending(false);
    }
  }, [isLoaded, signIn]);

  // ── Forgot password: send reset code ─────────────────────────────────────
  const handleForgotPassword = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      await signIn!.create({
        strategy: 'reset_password_email_code',
        identifier: resetEmail.trim(),
      });
      setStep('resetCode');
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, resetEmail]);

  // ── Forgot password: verify code + set new password ───────────────────────
  const handleResetVerify = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const result = await signIn!.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: resetCode.trim(),
      });
      if (result.status === 'needs_new_password') {
        const final = await signIn!.resetPassword({ password: newPassword });
        if (final.status === 'complete') {
          await setActive!({ session: final.createdSessionId });
        } else {
          setError(`Password reset returned status "${final.status}". Please try again.`);
        }
      } else if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId });
      } else {
        setError(`Verification returned status "${result.status}". Please try again.`);
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setLoading(false);
    }
  }, [isLoaded, signIn, resetCode, newPassword, setActive]);

  // ── Google SSO ────────────────────────────────────────────────────────────
  const handleGoogle = useCallback(async () => {
    setSsoLoading(true);
    setError(null);
    try {
      const result = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: Linking.createURL('/sso-callback'),
      });
      const { createdSessionId, setActive: ssoSetActive, signIn: ssoSignIn } = result;

      if (createdSessionId && ssoSetActive) {
        // Existing Google account — signed in directly.
        await ssoSetActive({ session: createdSessionId });

      } else if (ssoSignIn?.firstFactorVerification?.status === 'transferable') {
        // New Google user arriving at sign-in — transfer to sign-up.
        if (!signUp) { setError('Sign-up unavailable. Please try again.'); return; }
        const su = await signUp.create({ transfer: true });
        if (su.status === 'complete' && ssoSetActive) {
          await ssoSetActive({ session: su.createdSessionId! });
        } else if (su.status !== 'complete') {
          setError(`Google sign-up returned status "${su.status}".`);
        }

      } else if (!createdSessionId) {
        setError('Google sign-in could not be completed. Please try again.');
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setSsoLoading(false);
    }
  }, [startSSOFlow, signUp]);

  const s = makeStyles(colors);

  // ── Second-factor step ────────────────────────────────────────────────────
  if (step === 'secondFactor') {
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
          {sfEmail ? (
            <Text style={s.subtitle}>
              we sent a verification code to{'\n'}
              <Text style={{ color: colors.foreground }}>{sfEmail}</Text>
            </Text>
          ) : null}

          <View style={s.card}>
            <Text style={s.label}>Verification Code</Text>
            <TextInput
              style={s.input}
              value={sfCode}
              onChangeText={setSfCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholderTextColor={colors.mutedForeground}
              placeholder="6-digit code"
              selectionColor={colors.primary}
              onSubmitEditing={handleSecondFactor}
              returnKeyType="go"
              autoFocus
            />
            {error ? <Text style={s.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                s.primaryBtn,
                pressed && s.pressed,
                (loading || sfCode.length < 6) && s.btnDisabled,
              ]}
              onPress={handleSecondFactor}
              disabled={loading || sfCode.length < 6}
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={s.primaryBtnText}>Verify</Text>
              )}
            </Pressable>
          </View>

          <View style={s.switchRow}>
            <Pressable onPress={handleResendCode} disabled={sfSending}>
              <Text style={s.mutedLink}>
                {sfSending ? 'sending…' : 'resend code'}
              </Text>
            </Pressable>
            <Text style={s.switchText}> · </Text>
            <Pressable onPress={() => { setStep('credentials'); setError(null); setSfCode(''); }}>
              <Text style={s.mutedLink}>back</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Forgot-password: email step ───────────────────────────────────────────
  if (step === 'resetEmail') {
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
          <Text style={s.tagline}>Reset your password</Text>
          <Text style={s.subtitle}>
            we'll send a code to your email
          </Text>

          <View style={s.card}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={resetEmail}
              onChangeText={setResetEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholderTextColor={colors.mutedForeground}
              placeholder="you@example.com"
              selectionColor={colors.primary}
              onSubmitEditing={handleForgotPassword}
              returnKeyType="go"
              autoFocus
            />
            {error ? <Text style={s.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                s.primaryBtn,
                pressed && s.pressed,
                (loading || !resetEmail) && s.btnDisabled,
              ]}
              onPress={handleForgotPassword}
              disabled={loading || !resetEmail}
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={s.primaryBtnText}>Send Code</Text>
              )}
            </Pressable>
          </View>

          <View style={s.switchRow}>
            <Pressable onPress={() => { setStep('credentials'); setError(null); }}>
              <Text style={s.mutedLink}>← back to sign in</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Forgot-password: code + new password step ─────────────────────────────
  if (step === 'resetCode') {
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
          <Text style={s.tagline}>Set a new password</Text>
          <Text style={s.subtitle}>
            enter the code sent to{'\n'}
            <Text style={{ color: colors.foreground }}>{resetEmail}</Text>
          </Text>

          <View style={s.card}>
            <Text style={s.label}>Code</Text>
            <TextInput
              style={s.input}
              value={resetCode}
              onChangeText={setResetCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholderTextColor={colors.mutedForeground}
              placeholder="6-digit code"
              selectionColor={colors.primary}
              autoFocus
            />

            <Text style={[s.label, { marginTop: 16 }]}>New Password</Text>
            <TextInput
              style={s.input}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              textContentType="newPassword"
              placeholderTextColor={colors.mutedForeground}
              placeholder="8+ characters"
              selectionColor={colors.primary}
              onSubmitEditing={handleResetVerify}
              returnKeyType="go"
            />

            {error ? <Text style={s.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                s.primaryBtn,
                pressed && s.pressed,
                (loading || resetCode.length < 6 || newPassword.length < 8) && s.btnDisabled,
              ]}
              onPress={handleResetVerify}
              disabled={loading || resetCode.length < 6 || newPassword.length < 8}
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={s.primaryBtnText}>Reset Password</Text>
              )}
            </Pressable>
          </View>

          <View style={s.switchRow}>
            <Pressable onPress={() => { setStep('resetEmail'); setError(null); }}>
              <Text style={s.mutedLink}>← resend code</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Credentials step (default) ────────────────────────────────────────────
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

          {/* Password + forgot link */}
          <View style={s.passwordHeader}>
            <Text style={s.label}>Password</Text>
            <Pressable
              onPress={() => {
                setResetEmail(email);
                setError(null);
                setStep('resetEmail');
              }}
              hitSlop={8}
            >
              <Text style={s.forgotLink}>Forgot password?</Text>
            </Pressable>
          </View>
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
            style={({ pressed }) => [
              s.primaryBtn,
              pressed && s.pressed,
              (loading || !email || !password) && s.btnDisabled,
            ]}
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

        {/* Item 6 copy — invite-only message; tappable to sign-up for testing */}
        <View style={s.switchRow}>
          <Text
            style={s.switchText}
            onPress={() => router.push('/(auth)/sign-up')}
            suppressHighlighting
          >
            pshpsh is invite-only.
          </Text>
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
    subtitle: {
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
    passwordHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginTop: 16,
      marginBottom: 8,
    },
    forgotLink: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: c.mutedForeground,
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
      alignItems: 'center',
      marginTop: 32,
    },
    switchText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: c.mutedForeground,
    },
    mutedLink: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: c.mutedForeground,
    },
  });
}
