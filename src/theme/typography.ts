import type { TextStyle } from 'react-native';

import type { ThemeTokens } from '@/src/theme/tokens';

/**
 * Semantic typography roles — source of truth matches the latest Stash screen
 * (Inter faces via tokens.fontFamily; no RN fontWeight on these styles).
 *
 * Stash mapping:
 * - chromeTitle → TopBar (“My Stash”)
 * - sectionTitle → “Your products” / “Recently stashed” (quiet, not display)
 * - tileTitle → category title / related product title
 * - tileMeta → category count / related brand
 * - tilePrice → related product price
 */
export type TypeRole =
  | 'chromeTitle'
  | 'sectionTitle'
  | 'tileTitle'
  | 'tileMeta'
  | 'tilePrice'
  | 'body'
  | 'bodyMuted'
  | 'identityBrand'
  | 'identityTitle'
  | 'offerMerchant'
  | 'offerPrice'
  | 'offerMeta'
  | 'cta'
  | 'link';

export function typeStyle(tokens: ThemeTokens, role: TypeRole): TextStyle {
  switch (role) {
    case 'chromeTitle':
      return {
        fontSize: tokens.fontSize.title,
        lineHeight: tokens.lineHeight.title,
        fontFamily: tokens.fontFamily.bold,
        color: tokens.color.text,
      };
    case 'sectionTitle':
      return {
        fontSize: tokens.fontSize.title,
        lineHeight: tokens.lineHeight.title,
        fontFamily: tokens.fontFamily.semibold,
        color: tokens.color.text,
        letterSpacing: -0.2,
      };
    case 'tileTitle':
      return {
        fontSize: tokens.fontSize.caption,
        lineHeight: tokens.lineHeight.caption,
        fontFamily: tokens.fontFamily.semibold,
        color: tokens.color.text,
      };
    case 'tileMeta':
      return {
        fontSize: tokens.fontSize.micro,
        lineHeight: tokens.lineHeight.micro,
        fontFamily: tokens.fontFamily.regular,
        color: tokens.color.textMuted,
      };
    case 'tilePrice':
      return {
        fontSize: tokens.fontSize.caption,
        lineHeight: tokens.lineHeight.caption,
        fontFamily: tokens.fontFamily.semibold,
        color: tokens.color.primary,
      };
    case 'body':
      return {
        fontSize: tokens.fontSize.body,
        lineHeight: tokens.lineHeight.body,
        fontFamily: tokens.fontFamily.regular,
        color: tokens.color.text,
      };
    case 'bodyMuted':
      return {
        fontSize: tokens.fontSize.body,
        lineHeight: tokens.lineHeight.body,
        fontFamily: tokens.fontFamily.regular,
        color: tokens.color.textMuted,
      };
    case 'identityBrand':
      return {
        fontSize: tokens.fontSize.micro,
        lineHeight: tokens.lineHeight.micro,
        fontFamily: tokens.fontFamily.regular,
        color: tokens.color.textMuted,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
      };
    case 'identityTitle':
      return {
        fontSize: tokens.fontSize.title,
        lineHeight: tokens.lineHeight.title,
        fontFamily: tokens.fontFamily.semibold,
        color: tokens.color.text,
      };
    case 'offerMerchant':
      return {
        fontSize: tokens.fontSize.body,
        lineHeight: tokens.lineHeight.body,
        fontFamily: tokens.fontFamily.regular,
        color: tokens.color.text,
      };
    case 'offerPrice':
      return {
        fontSize: tokens.fontSize.bodyStrong,
        lineHeight: tokens.lineHeight.bodyStrong,
        fontFamily: tokens.fontFamily.semibold,
        color: tokens.color.text,
      };
    case 'offerMeta':
      return {
        fontSize: tokens.fontSize.micro,
        lineHeight: tokens.lineHeight.micro,
        fontFamily: tokens.fontFamily.regular,
        color: tokens.color.textMuted,
      };
    case 'cta':
      return {
        fontSize: tokens.fontSize.label,
        lineHeight: tokens.lineHeight.label,
        fontFamily: tokens.fontFamily.semibold,
        color: tokens.color.primary,
      };
    case 'link':
      return {
        fontSize: tokens.fontSize.caption,
        lineHeight: tokens.lineHeight.caption,
        fontFamily: tokens.fontFamily.semibold,
        color: tokens.color.primary,
      };
    default:
      return {
        fontSize: tokens.fontSize.body,
        lineHeight: tokens.lineHeight.body,
        fontFamily: tokens.fontFamily.regular,
        color: tokens.color.text,
      };
  }
}
