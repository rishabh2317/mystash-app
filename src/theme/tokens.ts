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
  accent: string;
  /** Existing Buy CTA (titanium sky / nebula violet). */
  cta: string;
  success: string;
  successOn: string;
  warning: string;
  danger: string;
  tabBar: string;
  tabInactive: string;
  icon: string;
};

export type ThemeTokens = {
  mode: ThemeModeName;
  color: ThemeColorTokens;
  fontSize: {
    caption: number;
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
    pill: number;
  };
  stroke: {
    hairline: number;
    thin: number;
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
  };
};

const SHARED_TYPE = {
  fontSize: {
    caption: 12,
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
    pill: 999,
  },
  stroke: {
    hairline: 1,
    thin: 1,
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
  },
};

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
  accent: '#00AFC0',
  cta: '#0EA5E9',
  success: '#059669',
  successOn: '#FFFFFF',
  warning: '#B45309',
  danger: '#B91C1C',
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
  accent: '#A855F7',
  cta: '#A855F7',
  success: '#10B981',
  successOn: '#FFFFFF',
  warning: '#FBBF24',
  danger: '#FCA5A5',
  tabBar: '#0D111F',
  tabInactive: '#AEB8C5',
  icon: '#F8FAFC',
};

export function getThemeTokens(mode: ThemeModeName): ThemeTokens {
  return {
    mode,
    color: mode === 'titanium' ? TITANIUM_COLOR : NEBULA_COLOR,
    ...SHARED_TYPE,
  };
}

export function pageCanvasGradient(tokens: ThemeTokens): readonly [string, string] {
  return [tokens.color.canvas, tokens.color.canvasEnd];
}

export function softCanvasGradient(tokens: ThemeTokens): readonly [string, string] {
  return [tokens.color.canvasSoft, tokens.color.canvasSoftEnd];
}
