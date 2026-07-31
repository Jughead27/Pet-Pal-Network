/**
 * Shared Button component — hairline-outline CTA.
 *
 * variant="primary"  transparent bg, 1 px foreground border (~55% opacity at
 *                    rest, full opacity on press), foreground label, weight 500.
 *                    No fill. borderRadius 10. paddingVertical 13,
 *                    paddingHorizontal 28, minHeight 44. Sizes to content.
 *
 * variant="quiet"    Typographic only — no bg, no border, muted label.
 *
 * Pressed state: border brightens to full-opacity foreground + faint rgba wash.
 * No scale / spring. reduce-motion respected (no animations used at all).
 * disabled: border + label rendered at ~35% opacity; presses ignored.
 */

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

// foreground is always #F0F4F8 in this app's single palette.
// 0x8C / 0xFF ≈ 0.549  → "~55% opacity" rest state.
const BORDER_ALPHA_REST    = '8C'; // appended to foreground hex
// Pressed wash: same foreground at 6% opacity.
const PRESSED_WASH         = 'rgba(240,244,248,0.06)';

export interface ButtonProps {
  /** Text label. Pass `children` instead for custom content. */
  label?: string;
  children?: React.ReactNode;
  onPress?: PressableProps['onPress'];
  disabled?: boolean;
  /**
   * Stretch to parent width.
   * alignSelf:'stretch' + width:'100%'.
   * NOT used in the pilot — reserved for future callsites.
   */
  fullWidth?: boolean;
  variant?: 'primary' | 'quiet';
  style?: StyleProp<ViewStyle>;
}

export default function Button({
  label,
  children,
  onPress,
  disabled = false,
  fullWidth = false,
  variant = 'primary',
  style,
}: ButtonProps) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        s.base,

        variant === 'primary' && {
          borderWidth: 1,
          // Border: full-opacity on press, ~55% at rest.
          borderColor: (pressed && !disabled)
            ? colors.foreground
            : `${colors.foreground}${BORDER_ALPHA_REST}`,
          // Faint wash on press; transparent at rest.
          backgroundColor: (pressed && !disabled) ? PRESSED_WASH : 'transparent',
        },

        variant === 'quiet' && {
          borderWidth: 0,
          backgroundColor: 'transparent',
        },

        fullWidth && s.fullWidth,
        disabled && s.disabled,
        style as ViewStyle,
      ]}
    >
      {label !== undefined ? (
        <Text
          style={[
            s.label,
            variant === 'primary' && { color: colors.foreground },
            variant === 'quiet'   && { color: colors.mutedForeground },
          ]}
        >
          {label}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: {
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 28,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
  },
  disabled: {
    opacity: 0.35,
  },
});
