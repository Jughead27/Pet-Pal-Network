import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SniffIcon from '@/components/SniffIcon';
import HatchlingIcon from '@/components/HatchlingIcon';

// ─── TabLayout ────────────────────────────────────────────────────────────────
//
// Always uses the Classic (Tabs) layout so every tab renders its custom icon.
// The NativeTabs / liquid-glass path was removed: NativeTabs only supports SF
// symbols via <Icon>, so it cannot render SniffIcon or HatchlingIcon, causing
// Expo Go to show a compass (safari SF symbol) and a dove (bird SF symbol).

export default function TabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: isWeb ? 1 : StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          paddingBottom: isWeb ? 0 : safeAreaInsets.bottom,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={90}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          marginBottom: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Feather name="home" size={22} color={color} />,
        }}
      />

      {/* Sniff — always the custom sniffing-dog SVG, never an SF symbol */}
      <Tabs.Screen
        name="discovery"
        options={{
          title: 'Sniff',
          tabBarAccessibilityLabel: 'Sniff',
          tabBarIcon: ({ color }) => <SniffIcon size={22} color={color} />,
        }}
      />

      <Tabs.Screen
        name="add"
        options={{
          title: 'Add',
          tabBarIcon: () => (
            // 44×44 touch target; 32px visible circle — no elevation, fully in-bar
            <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: colors.foreground,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather name="plus" size={18} color={colors.background} />
              </View>
            </View>
          ),
        }}
      />

      {/* Nursery — always the custom hatchling SVG, never an SF symbol */}
      <Tabs.Screen
        name="nursery"
        options={{
          title: 'Nursery',
          tabBarIcon: ({ color }) => <HatchlingIcon size={22} color={color} />,
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Feather name="user" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
