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
import { getBaseUrl } from '@workspace/api-client-react';

// Required for OAuth redirect to complete inside Expo Go.
WebBrowser.maybeCompleteAuthSession();

type Step =
  | 'credentials'   // normal email + password
  | 'resetEmail'    // forgot-password: enter email
  | 'resetCode'     // forgot-password: enter code + new password
  | 'secondFactor'  // device / client-trust: enter emailed code
  | 'invite';       // request-an-invite capture

const LOGO = require('@/assets/icon.png');

// ── Design tokens (portal palette) ────────────────────────────────────────────
const BG         = '#060B10';
const FG         = '#F0F4F8';
const MUTED      = '#6B7FA0';
const BORDER     = '#182030';
const DESTRUCTIVE = '#FF4444';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();

  const { signIn, setActive, isLoaded } = useSignIn();
  const { signUp } = useSignUp(); // needed for Google → new-user transfer
  const { startSSOFlow } = useSSO();

  const [step, setStep] = useState<Step>('credentials');

  // ── Credentials step ──────────────────────────────────────────────────────
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  // ── Second-factor step ────────────────────────────────────────────────────
  const [sfCode, setSfCode]     = useState('');
  const [sfSending, setSfSending] = useState(false);
  const [sfEmail, setSfEmail]   = useState('');

  // ── Forgot-password steps ─────────────────────────────────────────────────
  const [resetEmail, setResetEmail]     = useState('');
  const [resetCode, setResetCode]       = useState('');
  const [newPassword, setNewPassword]   = useState('');

  // ── Invite-request step ───────────────────────────────────────────────────
  const [inviteEmail, setInviteEmail]   = useState('');
  const [invitePet, setInvitePet]       = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteError, setInviteError]   = useState<string | null>(null);

  // ── Shared ────────────────────────────────────────────────────────────────
  const [loading, setLoading]       = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function clerkMessage(err: unknown): string {
    const e = err as { errors?: { longMessage?: string; message?: string }[] };
    return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? 'an error occurred. please try again.';
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
        const emailCodeFactor = (
          result.supportedSecondFactors as Array<{ strategy: string; safeIdentifier?: string }> | undefined
        )?.find(f => f.strategy === 'email_code');

        if (!emailCodeFactor) {
          const strategies = (result.supportedSecondFactors as Array<{ strategy: string }> | undefined)
            ?.map(f => f.strategy).join(', ') ?? 'unknown';
          setError(`additional verification required (${strategies}). contact support.`);
          return;
        }

        setSfEmail(emailCodeFactor.safeIdentifier ?? email.trim());
        setSfSending(true);
        await signIn!.prepareSecondFactor({ strategy: 'email_code' });
        setSfSending(false);
        setStep('secondFactor');

      } else {
        setError(`sign-in returned status "${result.status}". check your clerk dashboard configuration.`);
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
        setError(`verification returned status "${result.status}". please try again.`);
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
          setError(`password reset returned status "${final.status}". please try again.`);
        }
      } else if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId });
      } else {
        setError(`verification returned status "${result.status}". please try again.`);
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
        await ssoSetActive({ session: createdSessionId });

      } else if (ssoSignIn?.firstFactorVerification?.status === 'transferable') {
        if (!signUp) { setError('sign-up unavailable. please try again.'); return; }
        const su = await signUp.create({ transfer: true });
        if (su.status === 'complete' && ssoSetActive) {
          await ssoSetActive({ session: su.createdSessionId! });
        } else if (su.status !== 'complete') {
          setError(`google sign-up returned status "${su.status}".`);
        }

      } else if (!createdSessionId) {
        setError('google sign-in could not be completed. please try again.');
      }
    } catch (err) {
      setError(clerkMessage(err));
    } finally {
      setSsoLoading(false);
    }
  }, [startSSOFlow, signUp]);

  // ── Invite request submit ─────────────────────────────────────────────────
  const handleInviteSubmit = useCallback(async () => {
    setInviteLoading(true);
    setInviteError(null);
    try {
      const baseUrl = getBaseUrl() ?? '';
      const res = await fetch(`${baseUrl}/api/invites/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          note: invitePet.trim() || undefined,
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) {
        setInviteError(data.error ?? 'something went wrong. please try again.');
      } else {
        setInviteSuccess(true);
      }
    } catch {
      setInviteError('could not submit request. check your connection and try again.');
    } finally {
      setInviteLoading(false);
    }
  }, [inviteEmail, invitePet]);

  // ── Portal header (shared across all steps) ───────────────────────────────
  const renderHeader = (subtitle?: { line1: string; line2?: string }) => (
    <View style={s.header}>
      <Image source={LOGO} style={s.logo} resizeMode="contain" />
      <Text style={s.wordmark}>pshpsh</Text>
      {subtitle ? (
        <View style={s.sloganWrap}>
          <Text style={s.slogan1}>{subtitle.line1}</Text>
          {subtitle.line2 ? <Text style={s.slogan2}>{subtitle.line2}</Text> : null}
        </View>
      ) : (
        <View style={s.sloganWrap}>
          <Text style={s.slogan1}>follow pets, not people.</Text>
          <Text style={s.slogan2}>curl up, you're home.</Text>
        </View>
      )}
    </View>
  );

  // ── Second-factor step ────────────────────────────────────────────────────
  if (step === 'secondFactor') {
    return (
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.col}>
            {renderHeader({ line1: 'check your email.' })}

            {sfEmail ? (
              <Text style={s.recipientLine}>
                we sent a code to{' '}
                <Text style={{ color: FG }}>{sfEmail}</Text>
              </Text>
            ) : null}
            <Text style={s.spamHint}>not seeing it? check your spam folder</Text>

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>verification code</Text>
              <TextInput
                style={s.underlineInput}
                value={sfCode}
                onChangeText={setSfCode}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                placeholderTextColor={MUTED}
                placeholder="6-digit code"
                selectionColor={FG}
                onSubmitEditing={handleSecondFactor}
                returnKeyType="go"
                autoFocus
              />
            </View>

            {error ? <Text style={s.errorText}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [s.primaryAction, pressed && s.dimmed, (loading || sfCode.length < 6) && s.disabled]}
              onPress={handleSecondFactor}
              disabled={loading || sfCode.length < 6}
            >
              {loading
                ? <ActivityIndicator color={FG} size="small" />
                : <Text style={s.primaryActionText}>verify</Text>}
            </Pressable>

            <View style={s.whisperRow}>
              <Pressable onPress={handleResendCode} disabled={sfSending}>
                <Text style={s.whisper}>{sfSending ? 'sending…' : 'resend code'}</Text>
              </Pressable>
              <Text style={s.whisperDot}> · </Text>
              <Pressable onPress={() => { setStep('credentials'); setError(null); setSfCode(''); }}>
                <Text style={s.whisper}>back</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Forgot-password: email step ───────────────────────────────────────────
  if (step === 'resetEmail') {
    return (
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.col}>
            {renderHeader({ line1: 'reset your password.' })}

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>email</Text>
              <TextInput
                style={s.underlineInput}
                value={resetEmail}
                onChangeText={setResetEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholderTextColor={MUTED}
                placeholder="you@example.com"
                selectionColor={FG}
                onSubmitEditing={handleForgotPassword}
                returnKeyType="go"
                autoFocus
              />
            </View>

            {error ? <Text style={s.errorText}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [s.primaryAction, pressed && s.dimmed, (loading || !resetEmail) && s.disabled]}
              onPress={handleForgotPassword}
              disabled={loading || !resetEmail}
            >
              {loading
                ? <ActivityIndicator color={FG} size="small" />
                : <Text style={s.primaryActionText}>send code</Text>}
            </Pressable>

            <View style={s.whisperRow}>
              <Pressable onPress={() => { setStep('credentials'); setError(null); }}>
                <Text style={s.whisper}>← back to sign in</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Forgot-password: code + new password step ─────────────────────────────
  if (step === 'resetCode') {
    return (
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.col}>
            {renderHeader({ line1: 'set a new password.' })}

            <Text style={s.recipientLine}>
              enter the code sent to{' '}
              <Text style={{ color: FG }}>{resetEmail}</Text>
            </Text>

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>code</Text>
              <TextInput
                style={s.underlineInput}
                value={resetCode}
                onChangeText={setResetCode}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                placeholderTextColor={MUTED}
                placeholder="6-digit code"
                selectionColor={FG}
                autoFocus
              />
            </View>

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>new password</Text>
              <TextInput
                style={s.underlineInput}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                textContentType="newPassword"
                placeholderTextColor={MUTED}
                placeholder="8+ characters"
                selectionColor={FG}
                onSubmitEditing={handleResetVerify}
                returnKeyType="go"
              />
            </View>

            {error ? <Text style={s.errorText}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                s.primaryAction, pressed && s.dimmed,
                (loading || resetCode.length < 6 || newPassword.length < 8) && s.disabled,
              ]}
              onPress={handleResetVerify}
              disabled={loading || resetCode.length < 6 || newPassword.length < 8}
            >
              {loading
                ? <ActivityIndicator color={FG} size="small" />
                : <Text style={s.primaryActionText}>reset password</Text>}
            </Pressable>

            <View style={s.whisperRow}>
              <Pressable onPress={() => { setStep('resetEmail'); setError(null); }}>
                <Text style={s.whisper}>← resend code</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Invite-request step ───────────────────────────────────────────────────
  if (step === 'invite') {
    // Success confirmation state
    if (inviteSuccess) {
      return (
        <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            contentContainerStyle={[s.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.col}>
              {renderHeader({ line1: "thank you.", line2: "we'll call you." })}

              <View style={[s.whisperRow, { marginTop: 64 }]}>
                <Pressable onPress={() => {
                  setStep('credentials');
                  setInviteSuccess(false);
                  setInviteEmail('');
                  setInvitePet('');
                  setInviteError(null);
                }}>
                  <Text style={s.whisper}>← back to sign in</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      );
    }

    const inviteReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim());

    return (
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.col}>
            {renderHeader({ line1: 'request an invite.' })}

            <View style={s.fieldGroup}>
              <Text style={s.fieldLabel}>email</Text>
              <TextInput
                style={s.underlineInput}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholderTextColor={MUTED}
                placeholder="you@example.com"
                selectionColor={FG}
                autoFocus
              />
            </View>

            <View style={s.fieldGroup}>
              <View style={s.fieldLabelRow}>
                <Text style={s.fieldLabel}>tell us about your pet</Text>
                <Text style={s.charCount}>{invitePet.length}/200</Text>
              </View>
              <TextInput
                style={[s.underlineInput, s.multilineInput]}
                value={invitePet}
                onChangeText={t => setInvitePet(t.slice(0, 200))}
                multiline
                numberOfLines={3}
                placeholderTextColor={MUTED}
                placeholder="optional"
                selectionColor={FG}
                textAlignVertical="top"
              />
            </View>

            {inviteError ? <Text style={s.errorText}>{inviteError}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                s.primaryAction, pressed && s.dimmed, (!inviteReady || inviteLoading) && s.disabled,
              ]}
              onPress={handleInviteSubmit}
              disabled={!inviteReady || inviteLoading}
            >
              {inviteLoading
                ? <ActivityIndicator color={FG} size="small" />
                : <Text style={s.primaryActionText}>send request</Text>}
            </Pressable>

            <View style={s.whisperRow}>
              <Pressable onPress={() => { setStep('credentials'); setInviteError(null); }}>
                <Text style={s.whisper}>cancel</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Credentials step (default) ────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.col}>
          {/* ── Portal header ── */}
          {renderHeader()}

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
            <View style={s.fieldLabelRow}>
              <Text style={s.fieldLabel}>password</Text>
              <Pressable
                onPress={() => { setResetEmail(email); setError(null); setStep('resetEmail'); }}
                hitSlop={8}
              >
                <Text style={s.whisper}>forgot password?</Text>
              </Pressable>
            </View>
            <TextInput
              style={s.underlineInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              placeholderTextColor={MUTED}
              placeholder="••••••••"
              selectionColor={FG}
              onSubmitEditing={handleSignIn}
              returnKeyType="go"
            />
          </View>

          {error ? <Text style={s.errorText}>{error}</Text> : null}

          {/* ── Primary action ── */}
          <Pressable
            style={({ pressed }) => [s.primaryAction, pressed && s.dimmed, (!email || !password || loading) && s.disabled]}
            onPress={handleSignIn}
            disabled={!email || !password || loading}
          >
            {loading
              ? <ActivityIndicator color={FG} size="small" />
              : <Text style={s.primaryActionText}>sign in</Text>}
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

          {/* ── Invite-only gate ── */}
          <View style={s.inviteGate}>
            <Text style={s.inviteGateText}>pshpsh is invite-only.</Text>
            <Pressable
              onPress={() => {
                setInviteEmail(email);
                setInviteError(null);
                setInviteSuccess(false);
                setStep('invite');
              }}
              hitSlop={8}
            >
              <Text style={s.inviteLink}>request an invite</Text>
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

  // Centers content in a phone-width column on wide (web desktop) viewports.
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
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 10,
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
  multilineInput: {
    minHeight: 72,
    paddingTop: 10,
  },
  charCount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: MUTED,
    opacity: 0.6,
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
  dimmed: { opacity: 0.65 },

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
  whisperDot: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: MUTED,
    opacity: 0.4,
  },

  // ── Invite gate (bottom of credentials step) ──────────────────────────────
  inviteGate: {
    alignItems: 'center',
    marginTop: 48,
    gap: 8,
  },
  inviteGateText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
    opacity: 0.7,
    textAlign: 'center',
  },
  inviteLink: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
    textAlign: 'center',
  },
});
