/**
 * pendingInviteStorage — platform-aware persistence for the pending invite code.
 *
 * The invite code must survive the signup redirect (and the OAuth browser
 * round-trip) so the post-auth redeem effect in (tabs)/_layout.tsx can call
 * POST /api/invites/redeem.
 *
 * expo-secure-store is a no-op on web (its web build is an empty module), so
 * every SecureStore call silently fails in the browser. On web we use
 * localStorage instead; on native we keep SecureStore.
 *
 * All methods are best-effort and never throw.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'pendingInviteCode';

export const pendingInviteStorage = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
      } catch {
        return null;
      }
    }
    try {
      return await SecureStore.getItemAsync(KEY);
    } catch {
      return null;
    }
  },

  async set(code: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, code);
      } catch { /* best-effort */ }
      return;
    }
    try {
      await SecureStore.setItemAsync(KEY, code);
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
