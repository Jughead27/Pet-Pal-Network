/**
 * useColumnWidth — effective app width for layout calculations.
 *
 * On web the entire app renders inside a centred phone-column that is capped
 * at COLUMN_MAX_WIDTH.  Any component that drives layout from the screen / window
 * width (grid thumbnail sizes, pop anchor offsets, exclusion zones) must call
 * this hook instead of useWindowDimensions().width or Dimensions.get('window').width
 * so that the values are correct inside the narrowed column.
 *
 * On native the full window width is returned unchanged — no behavioural difference.
 */

import { Platform, useWindowDimensions } from 'react-native';

/** Width of the centered phone column on web desktop (px). One source of truth. */
export const COLUMN_MAX_WIDTH = 430;

/**
 * Returns the effective app width.
 * - Web: min(windowWidth, COLUMN_MAX_WIDTH) — correct inside the column wrapper.
 * - Native: actual window width.
 */
export function useColumnWidth(): number {
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web') return width;
  return Math.min(width, COLUMN_MAX_WIDTH);
}
