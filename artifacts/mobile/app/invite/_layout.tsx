/**
 * Invite group layout — publicly accessible (no auth redirect).
 * Users with or without a session can land on an invite page.
 */
import { Stack } from 'expo-router';

export default function InviteLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />;
}
