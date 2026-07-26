import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

// Completes the OAuth redirect for both popup (web) and redirect (native) flows.
// Must be called at module level so it runs before any React tree mounts.
WebBrowser.maybeCompleteAuthSession();

export default function SSOCallbackScreen() {
  const colors = useColors();
  // The auth group _layout.tsx detects isSignedIn and redirects to /(tabs).
  // This screen is just a loading indicator shown during that transition.
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}
