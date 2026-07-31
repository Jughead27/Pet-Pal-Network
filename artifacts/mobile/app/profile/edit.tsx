/**
 * Edit profile screen — lets the owner update their username, display name,
 * city, and About blurb.
 *
 * UI principles:
 *   - Same quiet typographic language as the rest of the app.
 *   - Inline per-field server errors; no modals.
 *   - About field is multiline with a live character counter (max 200).
 *   - Client never enforces alone — server is the authority on all rules.
 *   - Username is NOT displayed back to user after save (spec: username is
 *     not shown on the profile — display_name is what people see).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import Button from '@/components/Button';
import {
  useGetMe,
  usePatchMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';

// ── Field error state ─────────────────────────────────────────────────────────

type FieldErrors = {
  username?:    string;
  displayName?: string;
  locationCity?: string;
  about?:       string;
  general?:     string;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function EditProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc     = useQueryClient();

  const { data: meData, isLoading } = useGetMe();
  const { mutate: patchMe, isPending: isSaving } = usePatchMe();

  // Form state — initialised from server data once loaded
  const [username,    setUsername]    = useState('');
  const [displayName, setDisplayName] = useState('');
  const [city,        setCity]        = useState('');
  const [about,       setAbout]       = useState('');
  const [errors,      setErrors]      = useState<FieldErrors>({});
  const [seeded,      setSeeded]      = useState(false);

  useEffect(() => {
    if (meData && !seeded) {
      setUsername(meData.username    ?? '');
      setDisplayName(meData.displayName ?? '');
      setCity(meData.locationCity   ?? '');
      setAbout(meData.about         ?? '');
      setSeeded(true);
    }
  }, [meData, seeded]);

  const handleSave = useCallback(() => {
    setErrors({});

    // Build only the fields that changed (merge semantics — don't send unchanged)
    // We always send all four fields for simplicity; the server handles unchanged values.
    const body: Record<string, string | null> = {
      displayName:  displayName.trim() || null,
      locationCity: city.trim()        || null,
      about:        about.trim()       || null,
    };
    // Only include username if non-empty (user may have left it blank meaning "keep current")
    const trimmedUsername = username.trim();
    if (trimmedUsername) {
      body.username = trimmedUsername;
    }

    patchMe(
      { data: body as Parameters<typeof patchMe>[0]['data'] },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
          router.back();
        },
        onError: (err: unknown) => {
          // Parse the error response for inline display
          const message = extractErrorMessage(err);
          const fieldError = classifyError(message);
          setErrors(fieldError);
        },
      },
    );
  }, [username, displayName, city, about, patchMe, qc]);

  if (isLoading || !seeded) {
    return (
      <View style={[styles.fill, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPad + 16, paddingBottom: insets.bottom + 60 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header row ── */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.7}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.screenTitle, { color: colors.foreground }]}>Edit profile</Text>
          <View style={styles.backBtn} /> {/* spacer to centre title */}
        </View>

        {/* ── Username ── */}
        <FieldBlock
          label="Username"
          hint="3–20 chars · letters, numbers, periods, underscores · starts with a letter"
          error={errors.username}
          colors={colors}
        >
          <TextInput
            value={username}
            onChangeText={(t) => { setUsername(t); setErrors((e) => ({ ...e, username: undefined })); }}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: errors.username ? (colors.destructive ?? '#EF4444') : colors.border, backgroundColor: colors.card },
            ]}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            returnKeyType="next"
            placeholder="your_username"
            placeholderTextColor={colors.mutedForeground}
            editable={!isSaving}
          />
        </FieldBlock>

        {/* ── Owner (display_name) ── */}
        <FieldBlock
          label="Owner"
          hint="Up to 40 characters. This is what people see."
          error={errors.displayName}
          colors={colors}
        >
          <TextInput
            value={displayName}
            onChangeText={(t) => { setDisplayName(t); setErrors((e) => ({ ...e, displayName: undefined })); }}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: errors.displayName ? (colors.destructive ?? '#EF4444') : colors.border, backgroundColor: colors.card },
            ]}
            autoCapitalize="words"
            returnKeyType="next"
            placeholder="Your name"
            placeholderTextColor={colors.mutedForeground}
            editable={!isSaving}
          />
        </FieldBlock>

        {/* ── City ── */}
        <FieldBlock
          label="City"
          error={errors.locationCity}
          colors={colors}
        >
          <TextInput
            value={city}
            onChangeText={(t) => { setCity(t); setErrors((e) => ({ ...e, locationCity: undefined })); }}
            style={[
              styles.input,
              { color: colors.foreground, borderColor: errors.locationCity ? (colors.destructive ?? '#EF4444') : colors.border, backgroundColor: colors.card },
            ]}
            autoCapitalize="words"
            returnKeyType="next"
            placeholder="e.g. Melbourne"
            placeholderTextColor={colors.mutedForeground}
            editable={!isSaving}
          />
        </FieldBlock>

        {/* ── About the Owner ── */}
        <FieldBlock
          label="About the Owner"
          error={errors.about}
          colors={colors}
          counter={{ current: about.trim().length, max: 200 }}
        >
          <TextInput
            value={about}
            onChangeText={(t) => { setAbout(t); setErrors((e) => ({ ...e, about: undefined })); }}
            style={[
              styles.input,
              styles.inputMultiline,
              { color: colors.foreground, borderColor: errors.about ? (colors.destructive ?? '#EF4444') : colors.border, backgroundColor: colors.card },
            ]}
            multiline
            numberOfLines={4}
            returnKeyType="default"
            placeholder="A short line about you…"
            placeholderTextColor={colors.mutedForeground}
            editable={!isSaving}
            maxLength={210} // soft-cap at 210; server rejects >200 trimmed
          />
        </FieldBlock>

        {/* ── General server error ── */}
        {errors.general ? (
          <Text style={[styles.generalError, { color: colors.destructive ?? '#EF4444' }]}>
            {errors.general}
          </Text>
        ) : null}

        {/* ── Save button ── */}
        <Button
          variant="primary"
          fullWidth
          onPress={handleSave}
          disabled={isSaving}
          style={{ marginTop: 8 }}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.foreground} size="small" />
          ) : (
            <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.foreground }}>Save</Text>
          )}
        </Button>
        <Button
          variant="quiet"
          label="Cancel"
          onPress={() => router.back()}
        />

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── FieldBlock ────────────────────────────────────────────────────────────────

interface FieldBlockProps {
  label:    string;
  hint?:    string;
  error?:   string;
  colors:   ReturnType<typeof useColors>;
  counter?: { current: number; max: number };
  children: React.ReactNode;
}

function FieldBlock({ label, hint, error, colors, counter, children }: FieldBlockProps) {
  return (
    <View style={styles.fieldBlock}>
      <View style={styles.fieldLabelRow}>
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>{label}</Text>
        {counter && (
          <Text style={[
            styles.counter,
            { color: counter.current > counter.max ? (colors.destructive ?? '#EF4444') : colors.mutedForeground },
          ]}>
            {counter.current}/{counter.max}
          </Text>
        )}
      </View>
      {hint ? (
        <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>{hint}</Text>
      ) : null}
      {children}
      {error ? (
        <Text style={[styles.fieldError, { color: colors.destructive ?? '#EF4444' }]}>{error}</Text>
      ) : null}
    </View>
  );
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  // Orval/react-query wraps API errors; try to extract the server error field
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? 'Something went wrong.';
}

/**
 * Route the server error string to the correct field or general bucket.
 * Matches on substrings so it is robust to minor message rewording.
 */
function classifyError(message: string): FieldErrors {
  const m = message.toLowerCase();
  if (m.includes('username') && (m.includes('taken') || m.includes('already'))) {
    return { username: 'That username is already taken.' };
  }
  if (m.includes('username') && (m.includes('reserved') || m.includes('invalid') || m.includes('characters') || m.includes('letter'))) {
    return { username: message };
  }
  if (m.includes('owner') || m.includes('display')) {
    return { displayName: message };
  }
  if (m.includes('city')) {
    return { locationCity: message };
  }
  if (m.includes('about')) {
    return { about: message };
  }
  return { general: message };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fill:    { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  scroll:  { flexGrow: 1, paddingHorizontal: 20 },

  headerRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   28,
  },
  backBtn: {
    width:          40,
    height:         40,
    alignItems:     'center',
    justifyContent: 'center',
  },
  screenTitle: {
    fontFamily:    'Inter_600SemiBold',
    fontSize:      17,
    letterSpacing: -0.2,
  },

  fieldBlock: {
    marginBottom: 22,
  },
  fieldLabelRow: {
    flexDirection:  'row',
    alignItems:     'baseline',
    justifyContent: 'space-between',
    marginBottom:   6,
  },
  fieldLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize:   14,
  },
  fieldHint: {
    fontFamily:   'Inter_400Regular',
    fontSize:     12,
    lineHeight:   16,
    marginBottom: 6,
  },
  fieldError: {
    fontFamily: 'Inter_400Regular',
    fontSize:   12,
    marginTop:  5,
  },
  counter: {
    fontFamily: 'Inter_400Regular',
    fontSize:   12,
  },

  input: {
    fontFamily:        'Inter_400Regular',
    fontSize:          15,
    borderWidth:       StyleSheet.hairlineWidth,
    borderRadius:      10,
    paddingHorizontal: 14,
    paddingVertical:   12,
  },
  inputMultiline: {
    minHeight:   100,
    textAlignVertical: 'top',
    paddingTop:  12,
  },

  generalError: {
    fontFamily:   'Inter_400Regular',
    fontSize:     13,
    marginBottom: 16,
  },

});
