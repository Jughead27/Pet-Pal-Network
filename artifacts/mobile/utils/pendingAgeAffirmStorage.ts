/**
 * pendingAgeAffirmStorage — platform-aware persistence for the 13+ age
 * affirmation checked on the signup form.
 *
 * The affirmation must survive the signup → email-verification →
 * session-activation transition (React state can be lost across redirects on
 * web), so the post-auth effect in (tabs)/_layout.tsx can POST
 * /api/age/affirm silently instead of showing the retroactive age gate to a
 * brand-new account.
 *
 * Mirrors pendingDisplayNameStorage: localStorage on web (expo-secure-store
 * is a no-op there), SecureStore on native. The stored email guards against
 * a stale value from an abandoned signup being applied to a different
 * account. All methods are best-effort and never throw.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'pendingAgeAffirm';

export type PendingAgeAffirm = {
  /** The email the signup was started with — the affirmation is only ever
   *  applied to an account holding this address. Empty string for OAuth
   *  signups, where the email is unknown before the round-trip. */
  email: string;
  /** Epoch ms when the affirmation was checked. Email-less (OAuth) markers
   *  expire quickly and only apply to accounts created AFTER this moment,
   *  so a stale marker can never affirm an unrelated account. */
  savedAt: number;
};

function parse(raw: string | null): PendingAgeAffirm | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as PendingAgeAffirm;
    if (typeof v?.email === 'string' && typeof v?.savedAt === 'number') return v;
    return null;
  } catch {
    return null;
  }
}

export const pendingAgeAffirmStorage = {
  async get(): Promise<PendingAgeAffirm | null> {
    if (Platform.OS === 'web') {
      try {
        return typeof localStorage !== 'undefined' ? parse(localStorage.getItem(KEY)) : null;
      } catch {
        return null;
      }
    }
    try {
      return parse(await SecureStore.getItemAsync(KEY));
    } catch {
      return null;
    }
  },

  async set(value: PendingAgeAffirm): Promise<void> {
    const raw = JSON.stringify(value);
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, raw);
      } catch { /* best-effort */ }
      return;
    }
    try {
      await SecureStore.setItemAsync(KEY, raw);
    } catch { /* best-effort */ }
  },

  async clear(): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
      } catch { /* best-effort */ }
      return;
    }
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch { /* best-effort */ }
  },
};
