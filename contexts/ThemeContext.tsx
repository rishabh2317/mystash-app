import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Extrapolate, interpolate, useSharedValue, withTiming, useDerivedValue } from 'react-native-reanimated';

export type ThemeMode = 'titanium' | 'nebula';

type ThemeContextValue = {
  mode: ThemeMode;
  toggleTheme: () => void;
  /**
   * 0 -> titanium, 1 -> nebula during a transition. Note: we also expose lightOpacity/darkOpacity
   * so components can crossfade gradients, LEDs, and card frames.
   */
  transitionProgress: any;
  lightOpacity: any;
  darkOpacity: any;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('titanium');

  const transitionProgress = useSharedValue(1);
  const fromLight = useSharedValue(mode === 'titanium' ? 1 : 0);
  const toLight = useSharedValue(mode === 'titanium' ? 1 : 0);

  const lightOpacity = useDerivedValue(() => {
    return interpolate(transitionProgress.value, [0, 1], [fromLight.value, toLight.value], Extrapolate.CLAMP);
  });

  const darkOpacity = useDerivedValue(() => 1 - lightOpacity.value);

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = mode === 'titanium' ? 'nebula' : 'titanium';

    fromLight.value = mode === 'titanium' ? 1 : 0;
    toLight.value = next === 'titanium' ? 1 : 0;
    transitionProgress.value = 0;
    transitionProgress.value = withTiming(1, { duration: 500 });

    setMode(next);
  }, [mode, fromLight, toLight, transitionProgress]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      toggleTheme,
      transitionProgress,
      lightOpacity,
      darkOpacity,
    }),
    [mode, toggleTheme, transitionProgress, lightOpacity, darkOpacity],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode must be used within ThemeModeProvider');
  return ctx;
}

