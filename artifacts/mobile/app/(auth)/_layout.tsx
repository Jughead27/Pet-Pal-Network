import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Stack } from 'expo-router';

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();

  // Clerk hasn't resolved the session yet — render nothing so the
  // splash screen has time to hide before we redirect.
  if (!isLoaded) return null;

  // Already signed in — send straight to the app.
  if (isSignedIn) return <Redirect href="/(tabs)" />;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
  );
}
