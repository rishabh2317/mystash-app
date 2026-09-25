/**
 * App typeface — Inter matches the clean geometric sans used in the LTK-style
 * editorial references (SF/Product Sans–adjacent). Loaded once in root layout.
 */
export const APP_FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
} as const;

export type AppFontWeightKey = keyof typeof APP_FONT;

/** Map RN fontWeight tokens to the matching Inter face (needed on Android). */
export function appFontFamily(
  weight?: string | number | null,
): (typeof APP_FONT)[AppFontWeightKey] {
  const w = String(weight ?? '400');
  if (w === '500') return APP_FONT.medium;
  if (w === '600') return APP_FONT.semibold;
  if (w === '700') return APP_FONT.bold;
  if (w === '800' || w === '900') return APP_FONT.extraBold;
  return APP_FONT.regular;
}

/**
 * Style helper for Inter. Do NOT combine with fontWeight — expo-google-fonts
 * faces already encode weight; adding fontWeight makes RN fall back to system UI.
 */
export function appType(
  weight: AppFontWeightKey = 'regular',
): { fontFamily: (typeof APP_FONT)[AppFontWeightKey] } {
  return { fontFamily: APP_FONT[weight] };
}
