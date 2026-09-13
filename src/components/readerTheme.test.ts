import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEW_SETTINGS,
  VIEW_SETTINGS_KEY,
  clamp,
  loadReaderViewSettings,
  persistReaderViewSettings,
} from './readerTheme';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  globalThis.dispatchEvent = () => true;
});

describe('reader theme settings', () => {
  it('clamps numeric settings and preserves valid persisted choices', () => {
    storage.set(VIEW_SETTINGS_KEY, JSON.stringify({ fontSize: 99, contentWidth: 20, theme: 'night', layoutMode: 'double' }));
    const settings = loadReaderViewSettings(18);
    expect(clamp(5, 10, 20)).toBe(10);
    expect(settings.fontSize).toBe(30);
    expect(settings.contentWidth).toBe(36);
    expect(settings.theme).toBe('night');
    expect(settings.layoutMode).toBe('double');
  });

  it('falls back to defaults for malformed settings and persists the selected view', () => {
    storage.set(VIEW_SETTINGS_KEY, '{bad');
    expect(loadReaderViewSettings(21).fontSize).toBe(21);
    persistReaderViewSettings(DEFAULT_VIEW_SETTINGS);
    expect(JSON.parse(storage.get(VIEW_SETTINGS_KEY) || '{}').theme).toBe('paper');
  });
});
