import { APP_FONT } from '@/src/theme/appFont';

/**
 * Mystash semantic design tokens (UX-B.1).
 * Titanium / Nebula are the only theme modes. Values match the current app
 * so wiring the system does not redesign Home or restyle screens from scratch.
 *
 * Type: Inter (LTK-adjacent geometric sans) — sizes/lineHeights tuned to the
 * editorial reference rhythm (quiet section titles, calm muted body).
 */

export type ThemeModeName = 'titanium' | 'nebula';

/**
 * Outline-card border experiment (token-level only — flip to compare A/B/C).
 * A ultraSubtle · B refined (baseline) · C crisp
 */
export type OutlineBorderVariant = 'ultraSubtle' | 'refined' | 'crisp';

/** Dev switch — change this one constant to compare border treatments app-wide. */
export const OUTLINE_BORDER_VARIANT: OutlineBorderVariant = 'crisp';

/**
 * Nested semantic aliases for the outline-card language.
 * `surface.outlineCard` is transparent so page canvas/gradients show through;
 * cards are defined by border + structure, not a filled surface.
 */
export type ThemeSemanticTokens = {
  surface: {
    canvas: string;
    /** Transparent card shell — use via `outlineCardChrome()`, not as a page fill. */
    outlineCard: string;
  };
  border: {
    subtle: string;
    strong: string;
  };
  text: {
    primary: string;
    secondary: string;
  };
  accent: string;
};

export type ThemeColorTokens = {
  text: string;
  textMuted: string;
  textOnAccent: string;
  canvas: string;
  canvasEnd: string;
  /** Profile / Bag / Analytics washes (existing). */
  canvasSoft: string;
  canvasSoftEnd: string;
  surface: string;
  surfaceRaised: string;
  /** Recessed surface for rows/tiles nested inside a `surface` card. */
  surfaceSubtle: string;
  /**
   * Information-card shell fill — transparent so the page canvas/gradient
   * shows through. Prefer `outlineCardChrome()` for card chrome.
   */
  outlineCard: string;
  /** Quiet card/chrome border; tracks `OUTLINE_BORDER_VARIANT`. */
  border: string;
  borderStrong: string;
  /** Hairline separator inside a surface (quieter than `border`). */
  divider: string;
  overlay: string;
  overlayPressed: string;
  /**
   * Brand primary. Identical in both modes — the primary colour never changes
   * with the theme. Prefer this over `accent` for new/redesigned surfaces.
   */
  primary: string;
  /** Content laid on top of a `primary` fill. */
  onPrimary: string;
  /** Tinted primary container for prominent-but-calm CTAs and selected states. */
  primarySurface: string;
  /** Content laid on top of a `primarySurface` fill. */
  onPrimarySurface: string;
  /** Mode-specific accent. Screens still on the pre-redesign palette use this. */
  accent: string;
  /** Existing Buy CTA (titanium sky / nebula violet). */
  cta: string;
  success: string;
  successOn: string;
  warning: string;
  danger: string;
  /** Content laid on a `danger` fill (badges, destructive chips). */
  dangerOn: string;
  tabBar: string;
  tabInactive: string;
  icon: string;
};

/**
 * Immersive surfaces — chrome and content that sit directly on top of media
 * (reel stages, video embeds, full-bleed imagery).
 *
 * These are intentionally mode-invariant: the media underneath is always dark,
 * so the treatment must not flip with ThemeMode. They are semantic tokens, not
 * a second palette: use them only for UI laid over media.
 */
export type ThemeImmersiveTokens = {
  /** Opaque backdrop behind third-party video embeds / media stages. */
  stage: string;
  /** Opaque immersive chrome surface (tab bar, bottom dock). */
  surface: string;
  /** Translucent card floating over media. */
  surfaceRaised: string;
  /** Translucent chip / secondary card over media. */
  surfaceSubtle: string;
  /** Icon-control backdrop over media. */
  control: string;
  /** Icon-control backdrop where the media behind is unknown/bright. */
  controlStrong: string;
  /** Centred affordance scrim (play / pause). */
  scrim: string;
  text: string;
  textMuted: string;
  /** Shadow behind text laid directly on media. */
  textShadow: string;
  icon: string;
  iconMuted: string;
  border: string;
  borderStrong: string;
  /** Hairline between immersive chrome and media. */
  divider: string;
  /** Avatar / thumbnail ring over media. */
  ring: string;
  /** Inactive tab tint on the immersive tab bar. */
  tabInactive: string;
};

export type ThemeTokens = {
  mode: ThemeModeName;
  color: ThemeColorTokens;
  /** Outline-card / text / accent aliases — prefer for information cards. */
  semantic: ThemeSemanticTokens;
  immersive: ThemeImmersiveTokens;
  fontSize: {
    micro: number;
    caption: number;
    /** Dense label (product shelf name/price). */
    label: number;
    body: number;
    bodyStrong: number;
    title: number;
    section: number;
    display: number;
    /** Editorial page title (Collection / Product headline). */
    headline: number;
  };
  /** Paired with `fontSize`; same keys so a type step is chosen once. */
  lineHeight: {
    micro: number;
    caption: number;
    label: number;
    body: number;
    bodyStrong: number;
    title: number;
    section: number;
    display: number;
    headline: number;
  };
  fontWeight: {
    regular: '400';
    semibold: '600';
    bold: '700';
    extraBold: '800';
  };
  /** Loaded Inter faces — prefer these over raw fontWeight on Android. */
  fontFamily: {
    regular: string;
    medium: string;
    semibold: string;
    bold: string;
    extraBold: string;
  };
  space: {
    xxs: number;
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    /** Docks / sheets pinned to an edge. */
    xxl: number;
    pill: number;
  };
  stroke: {
    hairline: number;
    thin: number;
    /** Selection / emphasis ring. */
    strong: number;
  };
  elevation: {
    none: number;
    card: number;
  };
  overlay: {
    scrim: string;
    sheetMaxHeightRatio: number;
  };
  motion: {
    pressOpacity: number;
    themeMs: number;
    addToBagSuccessMs: number;
    thumbnailFadeMs: number;
    thumbnailFadeReducedMs: number;
  };
};

const SHARED_TYPE = {
  fontSize: {
    micro: 11,
    caption: 13,
    label: 13,
    body: 15,
    bodyStrong: 15,
    title: 16,
    section: 17,
    display: 20,
    headline: 22,
  },
  lineHeight: {
    micro: 14,
    caption: 18,
    label: 18,
    body: 22,
    bodyStrong: 22,
    title: 22,
    section: 24,
    display: 26,
    headline: 28,
  },
  fontWeight: {
    regular: '400' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extraBold: '800' as const,
  },
  fontFamily: {
    regular: APP_FONT.regular,
    medium: APP_FONT.medium,
    semibold: APP_FONT.semibold,
    bold: APP_FONT.bold,
    extraBold: APP_FONT.extraBold,
  },
  space: {
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 16,
    xxl: 22,
    pill: 999,
  },
  stroke: {
    hairline: 1,
    thin: 1,
    strong: 2,
  },
  elevation: {
    none: 0,
    /** Information cards are outline-only — no drop shadow. */
    card: 0,
  },
  overlay: {
    scrim: 'rgba(0,0,0,0.45)',
    sheetMaxHeightRatio: 0.9,
  },
  motion: {
    pressOpacity: 0.88,
    themeMs: 300,
    addToBagSuccessMs: 1800,
    thumbnailFadeMs: 300,
    thumbnailFadeReducedMs: 80,
  },
};

/** Primary is one colour for the whole product — never mode-dependent. */
const PRIMARY = '#00AFC0';
/** Light label on primary fills (switches, primary CTAs). */
const ON_PRIMARY = '#FFFFFF';

/**
 * Outline border A/B/C per mode. Refined matches the prior Mystash quiet border.
 * Ultra = almost invisible hairline; Crisp = clearly visible but still thin.
 */
const OUTLINE_BORDER: Record<ThemeModeName, Record<OutlineBorderVariant, string>> = {
  titanium: {
    ultraSubtle: 'rgba(0,0,0,0.04)',
    refined: 'rgba(0,0,0,0.08)',
    crisp: 'rgba(0,0,0,0.14)',
  },
  nebula: {
    ultraSubtle: 'rgba(255,255,255,0.06)',
    refined: 'rgba(255,255,255,0.10)',
    crisp: 'rgba(255,255,255,0.16)',
  },
};

function buildSemantic(color: ThemeColorTokens): ThemeSemanticTokens {
  return {
    surface: {
      canvas: color.canvas,
      outlineCard: color.outlineCard,
    },
    border: {
      subtle: color.border,
      strong: color.borderStrong,
    },
    text: {
      primary: color.text,
      secondary: color.textMuted,
    },
    accent: color.primary,
  };
}

/**
 * Mode-invariant on-media treatment (see ThemeImmersiveTokens). Exported so
 * static StyleSheet.create entries can consume the same tokens as inline
 * styles without reaching for raw colour literals.
 */
export const IMMERSIVE_TOKENS: ThemeImmersiveTokens = {
  stage: '#000000',
  surface: '#05070A',
  surfaceRaised: 'rgba(18,18,18,0.72)',
  surfaceSubtle: 'rgba(18,18,18,0.65)',
  control: 'rgba(0,0,0,0.38)',
  controlStrong: 'rgba(0,0,0,0.45)',
  scrim: 'rgba(0,0,0,0.28)',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.75)',
  textShadow: 'rgba(0,0,0,0.55)',
  icon: '#FFFFFF',
  iconMuted: 'rgba(255,255,255,0.85)',
  border: 'rgba(255,255,255,0.12)',
  borderStrong: 'rgba(255,255,255,0.18)',
  divider: 'rgba(255,255,255,0.08)',
  ring: 'rgba(255,255,255,0.35)',
  tabInactive: 'rgba(248,250,252,0.55)',
};

/** Bottom-up legibility scrim for content laid over media. */
const MEDIA_SCRIM_COLORS = ['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.82)'] as const;
const MEDIA_SCRIM_LOCATIONS = [0, 0.45, 1] as const;

const TITANIUM_COLOR: ThemeColorTokens = {
  text: '#1A1A1A',
  textMuted: '#666666',
  textOnAccent: '#F8FAFC',
  canvas: '#FFFFFF',
  canvasEnd: '#F7F7F7',
  canvasSoft: '#FFFFFF',
  canvasSoftEnd: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSubtle: '#F5F5F5',
  outlineCard: 'transparent',
  border: OUTLINE_BORDER.titanium[OUTLINE_BORDER_VARIANT],
  borderStrong: '#1A1A1A',
  divider: 'rgba(0,0,0,0.06)',
  overlay: 'rgba(0,0,0,0.06)',
  overlayPressed: 'rgba(0,0,0,0.10)',
  primary: PRIMARY,
  onPrimary: ON_PRIMARY,
  primarySurface: '#D9F1F4',
  onPrimarySurface: '#04494F',
  accent: '#00AFC0',
  cta: '#0EA5E9',
  success: '#059669',
  successOn: '#FFFFFF',
  warning: '#B45309',
  danger: '#B91C1C',
  dangerOn: '#FFFFFF',
  tabBar: '#FFFFFF',
  tabInactive: '#666666',
  icon: '#1A1A1A',
};

/**
 * Dark mode is neutral near-black, matching the redesigned Home. Every surface
 * here is white-alpha, so these few opaque values decide the whole theme's hue:
 * when they were navy every card layered over them read navy too.
 *
 * Information cards must use `outlineCard` (transparent) via `outlineCardChrome`,
 * not `surface` — `surface` stays as a lightly raised chrome fill for docks/sheets only.
 */
const NEBULA_COLOR: ThemeColorTokens = {
  text: '#FFFFFF',
  textMuted: '#A0A0A6',
  textOnAccent: '#1A1A1B',
  canvas: '#08080A',
  canvasEnd: '#101012',
  // Chrome sits a hair above the canvas and fades into it, so the top bar
  // reads as raised without leaving a visible band across the page.
  canvasSoft: '#0C0C0E',
  canvasSoftEnd: '#08080A',
  surface: 'rgba(255,255,255,0.06)',
  surfaceRaised: 'rgba(255,255,255,0.08)',
  surfaceSubtle: 'rgba(255,255,255,0.035)',
  outlineCard: 'transparent',
  border: OUTLINE_BORDER.nebula[OUTLINE_BORDER_VARIANT],
  borderStrong: '#FFFFFF',
  divider: 'rgba(255,255,255,0.08)',
  overlay: 'rgba(255,255,255,0.1)',
  overlayPressed: 'rgba(255,255,255,0.16)',
  primary: PRIMARY,
  onPrimary: ON_PRIMARY,
  primarySurface: '#12414C',
  onPrimarySurface: '#E6FAFC',
  accent: '#A855F7',
  cta: '#A855F7',
  success: '#10B981',
  successOn: '#FFFFFF',
  warning: '#FBBF24',
  danger: '#FCA5A5',
  dangerOn: '#FFFFFF',
  tabBar: '#0C0C0E',
  tabInactive: '#A0A0A6',
  icon: '#FFFFFF',
};

export function getThemeTokens(mode: ThemeModeName): ThemeTokens {
  const color = mode === 'titanium' ? TITANIUM_COLOR : NEBULA_COLOR;
  return {
    mode,
    color,
    semantic: buildSemantic(color),
    immersive: IMMERSIVE_TOKENS,
    ...SHARED_TYPE,
  };
}

/**
 * Information / multi-data card chrome — transparent fill + quiet outline border
 * so page canvas/gradients show through. Use for creator suggestion, category,
 * merchant/info, profile info cards. Do not use on media-first cards.
 */
export function outlineCardChrome(tokens: ThemeTokens): {
  backgroundColor: string;
  borderColor: string;
} {
  return {
    backgroundColor: tokens.semantic.surface.outlineCard,
    borderColor: tokens.semantic.border.subtle,
  };
}

/** Scrim ramp for text/controls resting on media (LinearGradient bottom-up). */
export function mediaScrimGradient(): {
  colors: readonly [string, string, string];
  locations: readonly [number, number, number];
} {
  return { colors: MEDIA_SCRIM_COLORS, locations: MEDIA_SCRIM_LOCATIONS };
}

export function pageCanvasGradient(tokens: ThemeTokens): readonly [string, string] {
  return [tokens.color.canvas, tokens.color.canvasEnd];
}

export function softCanvasGradient(tokens: ThemeTokens): readonly [string, string] {
  return [tokens.color.canvasSoft, tokens.color.canvasSoftEnd];
}
