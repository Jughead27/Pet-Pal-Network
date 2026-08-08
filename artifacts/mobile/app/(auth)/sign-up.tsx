import React, { useCallback, useEffect, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBaseUrl } from '@workspace/api-client-react';
import Button from '@/components/Button';
import { pendingInviteStorage } from '@/utils/pendingInviteStorage';
import { pendingDisplayNameStorage } from '@/utils/pendingDisplayNameStorage';

// Required for OAuth redirect to complete inside Expo Go.
WebBrowser.maybeCompleteAuthSession();

const LOGO = require('@/assets/icon.png');

// ── Design tokens (portal palette) ────────────────────────────────────────────
const BG          = '#060B10';
const FG          = '#F0F4F8';
const MUTED       = '#6B7FA0';
const BORDER      = '#182030';
const DESTRUCTIVE = '#FF4444';

// ── Gate sub-steps ────────────────────────────────────────────────────────────
type GateSub = 'block' | 'request' | 'success';

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const params  = useLocalSearchParams<{ inviteCode?: string }>();

  const { signUp, setActive, isLoaded } = useSignUp();
  const { signIn } = useSignIn(); // needed for Google → existing-user transfer
  const { startSSOFlow } = useSSO();

  // ── Invite gate ───────────────────────────────────────────────────────────
  const [inviteCode, setInviteCode]           = useState<string | null>(null);
  const [inviteCodeChecked, setInviteCodeChecked] = useState(false);
  const [gateSub, setGateSub]                 = useState<GateSub>('block');

  // Invite request form state (shown in gate)
  const [inviteEmail, setInviteEmail]         = useState('');
  const [invitePet, setInvitePet]             = useState('');
  const [inviteRequestLoading, setInviteRequestLoading] = useState(false);
  const [inviteRequestError, setInviteRequestError]     = useState<string | null>(null);

  // ── Main form state ───────────────────────────────────────────────────────
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode]         = useState('');

  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [verifying, setVerifying]   = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // ── ToS/Privacy consent — required before any signup path (email or OAuth)
  const [tosAgreed, setTosAgreed] = useState(false);

  // ── Load invite code on mount ─────────────────────────────────────────────
  // Priority: URL param (from /invite/[code]) > SecureStore (from previous landing page visit)
  useEffect(() => {
    const load = async () => {
      if (params.inviteCode && typeof params.inviteCode === 'string') {
        const code = params.inviteCode.trim();
        if (code) {
          setInviteCode(code);
          // Persist for OAuth round-trip survival (web-safe: localStorage on web)
          await pendingInviteStorage.set(code);
          setInviteCodeChecked(true);
          return;
        }
      }
      // Fallback: check storage (set by landing page or previous OAuth prep)
      const stored = await pendingInviteStorage.get();
      setInviteCode(stored ?? null);
      setInviteCodeChecked(true);
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helper ────────────────────────────────────────────────────────────────
  function clerkMessage(err: unknown): string {
    const e = err as { errors?: { longMessage?: string; message?: string }[] };
    return e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? 'an error occurred. please try again.';
  }

  // ── Step 1: Create account ────────────────────────────────────────────────
  const handleSignUp = useCallback(async () => {
    if (!isLoaded) return;
    if (!tosAgreed) {
      setError('please agree to the terms of service and privacy policy first.');
      return;
    }
    const name = displayName.trim();
    if (!name) {
      setError('please tell us what to call you.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Persist so it survives the verification step; the tabs layout applies
      // it to the account (PATCH /api/me) right after the session activates.
      await pendingDisplayNameStorage.set({ name, email: email.trim() });
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
  }, [isLoaded, signUp, email, password, displayName, tosAgreed]);

  // ── Step 2: Verify email OTP ──────────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (!isLoaded) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await signUp!.attemptEmailAddressVerification({ code });
      if (result.status === 'complete') {
        await setActive!({ session: result.createdSessionId });
        // pendingInviteCode already in SecureStore — tabs layout will redeem it
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
      // Persist invite code so it survives the OAuth round-trip through the browser
      if (inviteCode) {
        await pendingInviteStorage.set(inviteCode);
      }

      const result = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: Linking.createURL('/sso-callback'),
      });
      const { createdSessionId, setActive: ssoSetActive, signUp: ssoSignUp } = result;

      if (createdSessionId && ssoSetActive) {
        // New Google user — signed up directly.
        // pendingInviteCode is in SecureStore; tabs layout redeems it.
        await ssoSetActive({ session: createdSessionId });

      } else if (ssoSignUp?.verifications?.externalAccount?.status === 'transferable') {
        // Existing Google user arriving at sign-up → transfer to sign-in
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
  }, [startSSOFlow, signIn, inviteCode]);

  // ── Invite request submit (gate) ──────────────────────────────────────────
  const handleInviteRequest = useCallback(async () => {
    if (!inviteEmail.trim()) return;
    setInviteRequestLoading(true);
    setInviteRequestError(null);
    try {
      const baseUrl = getBaseUrl() ?? '';
      const res = await fetch(`${baseUrl}/api/invites/request`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: inviteEmail.trim(), about: invitePet.trim() }),
      });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setInviteRequestError(body.error ?? 'something went wrong. please try again.');
        return;
      }
      setGateSub('success');
    } catch {
      setInviteRequestError('could not send your request. check your connection and try again.');
    } finally {
      setInviteRequestLoading(false);
    }
  }, [inviteEmail, invitePet]);

  const pt = insets.top + (Platform.OS === 'web' ? 24 : 48);
  const pb = insets.bottom + 40;

  // ── Loading while reading SecureStore ─────────────────────────────────────
  if (!inviteCodeChecked) {
    return (
      <View style={[s.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={FG} size="small" />
      </View>
    );
  }

  // ── Gate: no invite code ──────────────────────────────────────────────────
  if (!inviteCode) {
    return (
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: pt, paddingBottom: pb }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.col}>
            {/* Portal header */}
            <View style={s.header}>
              <Image source={LOGO} style={s.logo} resizeMode="contain" />
              <Text style={s.wordmark}>pshpsh</Text>
            </View>

            {gateSub === 'block' && (
              <>
                <Text style={s.gateHeadline}>invite only.</Text>
                <Text style={s.gateSub}>
                  pshpsh is by invitation. if a friend called you in, tap their invite link to join.
                </Text>
                <Pressable
                  style={({ pressed }) => [s.primaryAction, pressed && s.dimmed]}
                  onPress={() => setGateSub('request')}
                >
                  <Text style={s.primaryActionText}>request an invite</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [s.secondaryAction, pressed && s.dimmed]}
                  onPress={() => router.push('/(auth)/sign-in')}
                >
                  <Text style={s.secondaryActionText}>← back to sign in</Text>
                </Pressable>
              </>
            )}

            {gateSub === 'request' && (
              <>
                <Text style={s.gateHeadline}>request an invite.</Text>
                <Text style={s.gateSub}>
                  we'll reach out when we open up more spots.
                </Text>

                <View style={s.fieldGroup}>
                  <Text style={s.fieldLabel}>your email</Text>
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
                  <Text style={s.fieldLabel}>tell us about your pets</Text>
                  <TextInput
                    style={[s.underlineInput, { paddingTop: 8 }]}
                    value={invitePet}
                    onChangeText={setInvitePet}
                    multiline
                    numberOfLines={3}
                    placeholderTextColor={MUTED}
                    placeholder="two cats and a betta fish..."
                    selectionColor={FG}
                    onSubmitEditing={handleInviteRequest}
                  />
                </View>

                {inviteRequestError ? (
                  <Text style={s.errorText}>{inviteRequestError}</Text>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    s.primaryAction,
                    pressed && s.dimmed,
                    (!inviteEmail.trim() || inviteRequestLoading) && s.disabled,
                  ]}
                  onPress={handleInviteRequest}
                  disabled={!inviteEmail.trim() || inviteRequestLoading}
                >
                  {inviteRequestLoading
                    ? <ActivityIndicator color={FG} size="small" />
                    : <Text style={s.primaryActionText}>send request</Text>}
                </Pressable>

                <Pressable
                  style={({ pressed }) => [s.secondaryAction, pressed && s.dimmed]}
                  onPress={() => setGateSub('block')}
                >
                  <Text style={s.secondaryActionText}>← back</Text>
                </Pressable>
              </>
            )}

            {gateSub === 'success' && (
              <>
                <Text style={s.gateHeadline}>thank you.</Text>
                <Text style={s.gateSub}>
                  we'll be in touch. the more pets the better.
                </Text>
                <Pressable
                  style={({ pressed }) => [s.secondaryAction, pressed && s.dimmed]}
                  onPress={() => router.push('/(auth)/sign-in')}
                >
                  <Text style={s.secondaryActionText}>← back to sign in</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Verification step ─────────────────────────────────────────────────────
  if (pendingVerification) {
    return (
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: pt, paddingBottom: pb }]}
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
        contentContainerStyle={[s.scroll, { paddingTop: pt, paddingBottom: pb }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={s.col}>
          {/* ── Portal header ── */}
          <View style={s.header}>
            <Image source={LOGO} style={s.logo} resizeMode="contain" />
            <Text style={s.wordmark}>pshpsh</Text>
            <View style={s.sloganWrap}>
              <Text style={s.slogan1}>a quiet corner of the internet, run by the animals.</Text>
              <Text style={s.slogan2}>no news, no noise, no metrics — just pets and the people who love them.</Text>
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

          {/* ── Display name field ── */}
          <View style={s.fieldGroup}>
            <Text style={s.fieldLabel}>what should we call you?</Text>
            <TextInput
              style={s.underlineInput}
              value={displayName}
              onChangeText={setDisplayName}
              autoCorrect={false}
              maxLength={40}
              textContentType="name"
              placeholderTextColor={MUTED}
              placeholder="your name"
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

          {/* ── ToS / Privacy consent — gates BOTH signup paths ── */}
          <Pressable
            style={s.consentRow}
            onPress={() => { setTosAgreed((v) => !v); setError(null); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: tosAgreed }}
            accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
            hitSlop={6}
          >
            <View style={[s.checkbox, tosAgreed && s.checkboxChecked]}>
              {tosAgreed && <Text style={s.checkboxMark}>✓</Text>}
            </View>
            <Text style={s.consentText}>
              I agree to the{' '}
              <Text style={s.consentLink} onPress={() => router.push('/terms')}>Terms of Service</Text>
              {' '}and{' '}
              <Text style={s.consentLink} onPress={() => router.push('/privacy')}>Privacy Policy</Text>
            </Text>
          </Pressable>

          {error ? <Text style={s.errorText}>{error}</Text> : null}

          {/* ── Primary action — shared hairline-outline CTA ── */}
          <Button
            variant="primary"
            fullWidth
            onPress={handleSignUp}
            disabled={loading || !email || !displayName.trim() || password.length < 8 || !tosAgreed}
            style={s.createBtn}
          >
            {loading
              ? <ActivityIndicator color={FG} size="small" />
              : <Text style={s.primaryActionText}>create account</Text>}
          </Button>

          {/* ── Google SSO — also gated on consent ── */}
          <Pressable
            style={({ pressed }) => [s.secondaryAction, pressed && s.dimmed, !tosAgreed && s.disabled]}
            onPress={() => {
              if (!tosAgreed) {
                setError('please agree to the terms of service and privacy policy first.');
                return;
              }
              handleGoogle();
            }}
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

          {/* ── Footer legal links ── */}
          <View style={s.whisperRow}>
            <Pressable onPress={() => router.push('/guidelines')} hitSlop={8}>
              <Text style={s.whisper}>guidelines</Text>
            </Pressable>
            <Text style={s.whisperDot}> · </Text>
            <Pressable onPress={() => router.push('/terms')} hitSlop={8}>
              <Text style={s.whisper}>terms</Text>
            </Pressable>
            <Text style={s.whisperDot}> · </Text>
            <Pressable onPress={() => router.push('/privacy')} hitSlop={8}>
              <Text style={s.whisper}>privacy</Text>
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

  // ── Gate ──────────────────────────────────────────────────────────────────
  gateHeadline: {
    fontFamily:    'Inter_700Bold',
    fontSize:      26,
    color:         FG,
    letterSpacing: -0.3,
    textAlign:     'center',
    marginBottom:  12,
  },
  gateSub: {
    fontFamily:   'Inter_400Regular',
    fontSize:     14,
    color:        MUTED,
    textAlign:    'center',
    lineHeight:   22,
    marginBottom: 40,
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

  // ── ToS / Privacy consent ─────────────────────────────────────────────────
  consentRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    marginTop:     4,
    marginBottom:  16,
  },
  checkbox: {
    width:          18,
    height:         18,
    borderRadius:   4,
    borderWidth:    1,
    borderColor:    MUTED,
    alignItems:     'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: FG,
  },
  checkboxMark: {
    color:      FG,
    fontSize:   12,
    lineHeight: 14,
  },
  consentText: {
    flex:       1,
    fontFamily: 'Inter_400Regular',
    fontSize:   12,
    color:      MUTED,
    lineHeight: 18,
  },
  consentLink: {
    color:               FG,
    textDecorationLine:  'underline',
  },
  createBtn: {
    marginTop: 8,
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
    fontFamily: 'Inter_500Medium',
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
