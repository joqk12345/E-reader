import { useCallback, useEffect, useState } from 'react';
import {
  APP_THEME_EVENT,
  applyAppTheme,
  loadAppThemePreference,
  persistAppThemePreference,
  resolveAppTheme,
  type AppThemePreference,
  type ResolvedAppTheme,
} from '../../components/appTheme';

export function useAppTheme() {
  const [preference, setPreference] = useState<AppThemePreference>(() => loadAppThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedAppTheme>(() => applyAppTheme(preference));

  useEffect(() => {
    const refresh = (event?: Event) => {
      const detail = event ? (event as CustomEvent<AppThemePreference>).detail : undefined;
      const nextPreference = detail || loadAppThemePreference();
      setPreference(nextPreference);
      setResolvedTheme(applyAppTheme(nextPreference));
    };

    refresh();
    window.addEventListener(APP_THEME_EVENT, refresh as EventListener);

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemThemeChange = () => {
      setResolvedTheme(applyAppTheme(preference));
    };
    media?.addEventListener?.('change', onSystemThemeChange);

    return () => {
      window.removeEventListener(APP_THEME_EVENT, refresh as EventListener);
      media?.removeEventListener?.('change', onSystemThemeChange);
    };
  }, [preference]);

  const setAppTheme = useCallback((nextPreference: AppThemePreference) => {
    setPreference(nextPreference);
    setResolvedTheme(resolveAppTheme(nextPreference));
    persistAppThemePreference(nextPreference);
  }, []);

  return { preference, resolvedTheme, setPreference: setAppTheme };
}
