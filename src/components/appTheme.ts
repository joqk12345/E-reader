export type AppThemePreference = 'light' | 'dark' | 'system';
export type ResolvedAppTheme = 'light' | 'dark';

export const APP_THEME_STORAGE_KEY = 'reader-app-theme';
export const APP_THEME_EVENT = 'reader:app-theme-updated';

const isAppThemePreference = (value: unknown): value is AppThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

export const loadAppThemePreference = (): AppThemePreference => {
  try {
    const value = localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isAppThemePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
};

export const resolveAppTheme = (preference: AppThemePreference): ResolvedAppTheme => {
  if (preference !== 'system') return preference;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const applyAppTheme = (preference: AppThemePreference): ResolvedAppTheme => {
  const resolved = resolveAppTheme(preference);
  const root = document.documentElement;
  root.dataset.appTheme = resolved;
  root.dataset.appThemePreference = preference;
  return resolved;
};

export const persistAppThemePreference = (preference: AppThemePreference) => {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, preference);
  } catch (error) {
    console.warn('Failed to persist app theme preference:', error);
  }

  applyAppTheme(preference);
  window.dispatchEvent(
    new CustomEvent<AppThemePreference>(APP_THEME_EVENT, { detail: preference }),
  );
};
