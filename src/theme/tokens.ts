/**
 * Mystash semantic design tokens (UX-B.1).
 * Titanium / Nebula are the only theme modes. Values match the current app
 * so wiring the system does not redesign Home or restyle screens from scratch.
 */

export type ThemeModeName = 'titanium' | 'nebula';

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
  border: string;
  borderStrong: string;
  overlay: string;
  overlayPressed: string;
  /**
   * Brand primary. Identical in both modes — the primary colour never changes
   * with the theme. Prefer this over `accent` for new/redesigned surfaces.
   */
  primary: string;
  /** Content laid on top of a `primary` fill. */
  onPrimary: string;
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
  };
  fontWeight: {
    regular: '400';
    semibold: '600';
    bold: '700';
    extraBold: '800';
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
    caption: 12,
    label: 13,
    body: 15,
    bodyStrong: 14,
    title: 17,
    section: 20,
    display: 22,
  },
  fontWeight: {
    regular: '400' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extraBold: '800' as const,
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
    lg: 14,
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
    card: 2,
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
const ON_PRIMARY = '#1A1A1B';

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
  text: '#1A1A1B',
  textMuted: '#4E5257',
  textOnAccent: '#F8FAFC',
  canvas: '#F3F4F6',
  canvasEnd: '#E5E7EB',
  canvasSoft: '#FDFDFD',
  canvasSoftEnd: '#E8E8E8',
  surface: 'rgba(255,255,255,0.95)',
  surfaceRaised: 'rgba(255,255,255,0.82)',
  border: 'rgba(0,0,0,0.08)',
  borderStrong: '#0F172A',
  overlay: 'rgba(0,0,0,0.06)',
  overlayPressed: 'rgba(0,0,0,0.10)',
  primary: PRIMARY,
  onPrimary: ON_PRIMARY,
  accent: '#00AFC0',
  cta: '#0EA5E9',
  success: '#059669',
  successOn: '#FFFFFF',
  warning: '#B45309',
  danger: '#B91C1C',
  dangerOn: '#FFFFFF',
  tabBar: '#FDFDFD',
  tabInactive: '#4E5257',
  icon: '#1A1A1B',
};

const NEBULA_COLOR: ThemeColorTokens = {
  text: '#F8FAFC',
  textMuted: '#AEB8C5',
  textOnAccent: '#1A1A1B',
  canvas: '#020617',
  canvasEnd: '#0F172A',
  canvasSoft: '#0D111F',
  canvasSoftEnd: '#020408',
  surface: 'rgba(255,255,255,0.06)',
  surfaceRaised: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.12)',
  borderStrong: '#F8FAFC',
  overlay: 'rgba(255,255,255,0.1)',
  overlayPressed: 'rgba(255,255,255,0.16)',
  primary: PRIMARY,
  onPrimary: ON_PRIMARY,
  accent: '#A855F7',
  cta: '#A855F7',
  success: '#10B981',
  successOn: '#FFFFFF',
  warning: '#FBBF24',
  danger: '#FCA5A5',
  dangerOn: '#FFFFFF',
  tabBar: '#0D111F',
  tabInactive: '#AEB8C5',
  icon: '#F8FAFC',
};

export function getThemeTokens(mode: ThemeModeName): ThemeTokens {
  return {
    mode,
    color: mode === 'titanium' ? TITANIUM_COLOR : NEBULA_COLOR,
    immersive: IMMERSIVE_TOKENS,
    ...SHARED_TYPE,
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
