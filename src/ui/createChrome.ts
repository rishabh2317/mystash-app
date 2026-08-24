import type { ThemeTokens } from '@/src/theme/tokens';
import {
  controlOpacity,
  resolveControlPhase,
  type ControlFlags,
} from '@/src/ui/contracts';

/**
 * UX-CREATE-B.8 — Create-stack chrome derived from UX-B tokens.
 * No parallel palette; screens must not invent ad-hoc Create colors.
 */

export function createFieldColors(
  tokens: ThemeTokens,
  opts?: { invalid?: boolean },
): {
  color: string;
  borderColor: string;
  backgroundColor: string;
  placeholderTextColor: string;
} {
  return {
    color: tokens.color.text,
    borderColor: opts?.invalid ? tokens.color.danger : tokens.color.border,
    backgroundColor: tokens.color.surface,
    placeholderTextColor: tokens.color.textMuted,
  };
}

export function createPrimaryButtonStyle(tokens: ThemeTokens, flags: ControlFlags = {}) {
  const phase = resolveControlPhase(flags);
  return {
    backgroundColor: tokens.color.cta,
    opacity: controlOpacity(phase, tokens.motion.pressOpacity),
    borderRadius: tokens.radius.md,
  };
}

export function createSecondaryButtonStyle(tokens: ThemeTokens, flags: ControlFlags = {}) {
  const phase = resolveControlPhase(flags);
  return {
    borderColor: tokens.color.border,
    opacity: controlOpacity(phase, tokens.motion.pressOpacity),
    borderRadius: tokens.radius.md,
  };
}

export function createSurfaceStyle(tokens: ThemeTokens) {
  return {
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.lg,
  };
}

export function createSegmentBadgeColors(
  tokens: ThemeTokens,
  segment: 'continue' | 'processing' | 'attention',
): { bg: string; fg: string } {
  if (segment === 'attention') {
    return {
      bg: tokens.mode === 'titanium' ? 'rgba(185,28,28,0.14)' : 'rgba(252,165,165,0.2)',
      fg: tokens.color.danger,
    };
  }
  if (segment === 'processing') {
    return {
      bg: tokens.mode === 'titanium' ? 'rgba(180,83,9,0.14)' : 'rgba(251,191,36,0.2)',
      fg: tokens.color.warning,
    };
  }
  return {
    bg: tokens.mode === 'titanium' ? 'rgba(5,150,105,0.14)' : 'rgba(16,185,129,0.22)',
    fg: tokens.color.success,
  };
}
