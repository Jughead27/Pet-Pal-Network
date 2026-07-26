/**
 * Admin area layout — simple Stack for triage screens.
 * Only admins can reach this area; the server enforces role on every endpoint.
 */
import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
