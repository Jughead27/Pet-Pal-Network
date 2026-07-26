/**
 * pshpsh design tokens — dark, minimal, cinematic.
 * (Fish Book was the working title during development.)
 *
 * Primary palette: deep navy-black with teal accent and coral highlights.
 * Inspired by the depth and iridescence of betta fish.
 */

const fishBookPalette = {
  text: '#F0F4F8',
  tint: '#3DD9CB',
  background: '#060B10',
  foreground: '#F0F4F8',
  card: '#0C1520',
  cardForeground: '#F0F4F8',
  primary: '#3DD9CB',
  primaryForeground: '#060B10',
  secondary: '#111E2C',
  secondaryForeground: '#F0F4F8',
  muted: '#111E2C',
  mutedForeground: '#6B7FA0',
  accent: '#FF7A5C',
  accentForeground: '#FFFFFF',
  destructive: '#FF4444',
  destructiveForeground: '#FFFFFF',
  border: '#182030',
  input: '#182030',
};

const colors = {
  // pshpsh is a dark-first app — both light and dark use the same deep palette
  light: fishBookPalette,
  dark: {
    // Legacy aliases
    text: '#F0F4F8',
    tint: '#3DD9CB',

    // Core surfaces
    background: '#060B10',
    foreground: '#F0F4F8',

    // Cards / elevated surfaces
    card: '#0C1520',
    cardForeground: '#F0F4F8',

    // Primary action color — aqua/teal (oceanic)
    primary: '#3DD9CB',
    primaryForeground: '#060B10',

    // Secondary surfaces
    secondary: '#111E2C',
    secondaryForeground: '#F0F4F8',

    // Muted elements
    muted: '#111E2C',
    mutedForeground: '#6B7FA0',

    // Accent — coral/warm (for reactions, treat)
    accent: '#FF7A5C',
    accentForeground: '#FFFFFF',

    // Destructive
    destructive: '#FF4444',
    destructiveForeground: '#FFFFFF',

    // Borders and inputs
    border: '#182030',
    input: '#182030',
  },

  radius: 12,
};

export default colors;
