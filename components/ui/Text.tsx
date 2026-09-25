import React from 'react';
import {
  StyleSheet,
  Text as RNText,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { APP_FONT, appFontFamily } from '@/src/theme/appFont';

/**
 * App-wide Text: always resolves to an Inter_* face.
 * Strips fontWeight so RN never falls back to system SF/Roboto.
 */
export function Text({ style, ...rest }: TextProps) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const existing = typeof flat.fontFamily === 'string' ? flat.fontFamily : undefined;
  const fontFamily =
    existing && existing.startsWith('Inter_')
      ? existing
      : appFontFamily(flat.fontWeight) ?? APP_FONT.regular;

  const cleaned: TextStyle = { ...flat };
  delete cleaned.fontWeight;
  delete cleaned.fontFamily;

  return <RNText {...rest} style={[cleaned, { fontFamily }]} />;
}
