/**
 * pendingDisplayNameStorage — platform-aware persistence for the display name
 * typed on the email/password signup form.
 *
 * The name must survive the signup → email-verification → session-activation
 * transition (React state can be lost across redirects on web), so the
 * post-auth effect in (tabs)/_layout.tsx can PATCH /api/me with it.
 *
 * expo-secure-store is a no-op on web (its web build is an empty module), so
 * on web we use localStorage; on native we keep SecureStore.
 *
 * All methods are best-effort and never throw.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'pendingDisplayName';

export type PendingDisplayName = {
  /** The name the user typed on the signup form. */
  name: string;
  /** The email the signup was started with — the name is only ever applied to
   *  an account holding this address, so a stale value from an abandoned
   *  signup can never be written onto a different account. */
  email: string;
};

function parse(raw: string | null): PendingDisplayName | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as PendingDisplayName;
    if (typeof v?.name === 'string' && typeof v?.email === 'string') return v;
    return null;
  } catch {
    return null;
  }
}

export const pendingDisplayNameStorage = {
  async get(): Promise<PendingDisplayName | null> {
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

  async set(value: PendingDisplayName): Promise<void> {
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
