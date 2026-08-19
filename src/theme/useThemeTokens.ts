import { useThemeMode } from '@/contexts/ThemeContext';
import type { ThemeTokens } from '@/src/theme/tokens';

export function useThemeTokens(): ThemeTokens & { isLight: boolean } {
  const { tokens, isLight } = useThemeMode();
  return { ...tokens, isLight };
}
