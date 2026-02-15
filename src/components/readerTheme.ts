export type ReaderThemeId = 'white' | 'paper' | 'mint' | 'sepia' | 'night';

export type ReaderViewSettings = {
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  theme: ReaderThemeId;
  layoutMode: 'single' | 'double';
  bilingualViewMode: 'both' | 'source' | 'translation';
  cjkLetterSpacingEnabled: boolean;
  cjkLetterSpacing: number;
  expandDetails: boolean;
};

export const VIEW_SETTINGS_KEY = 'vmark-reader-settings';

export const READER_THEMES: Record<
  ReaderThemeId,
  {
    background: string;
    foreground: string;
    secondary: string;
    border: string;
    link: string;
    codeBg: string;
    codeText: string;
    isDark: boolean;
  }
> = {
  white: {
    background: '#FFFFFF',
    foreground: '#1a1a1a',
    secondary: '#f8f8f8',
    border: '#eeeeee',
    link: '#0066cc',
    codeBg: '#f5f5f5',
    codeText: '#1a1a1a',
    isDark: false,
  },
  paper: {
    background: '#EEEDED',
    foreground: '#1a1a1a',
    secondary: '#e5e4e4',
    border: '#d5d4d4',
    link: '#0066cc',
    codeBg: '#e5e4e4',
    codeText: '#1a1a1a',
    isDark: false,
  },
  mint: {
    background: '#CCE6D0',
    foreground: '#2d3a35',
    secondary: '#b8d9bd',
    border: '#a8c9ad',
    link: '#1a6b4a',
    codeBg: '#b8d9bd',
    codeText: '#2d3a35',
    isDark: false,
  },
  sepia: {
    background: '#F9F0DB',
    foreground: '#5c4b37',
    secondary: '#f0e5cc',
    border: '#e0d5bc',
    link: '#8b4513',
    codeBg: '#f0e5cc',
    codeText: '#5c4b37',
    isDark: false,
  },
  night: {
    background: '#23262b',
    foreground: '#d6d9de',
    secondary: '#2a2e34',
    border: '#3a3f46',
    link: '#5aa8ff',
    codeBg: '#2a2e34',
    codeText: '#d6d9de',
    isDark: true,
  },
};

export const DEFAULT_VIEW_SETTINGS: ReaderViewSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  contentWidth: 56,
  theme: 'paper',
  layoutMode: 'single',
  bilingualViewMode: 'both',
  cjkLetterSpacingEnabled: true,
  cjkLetterSpacing: 0.05,
  expandDetails: false,
};

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const loadReaderViewSettings = (readerFontSize: number): ReaderViewSettings => {
  try {
    const raw = localStorage.getItem(VIEW_SETTINGS_KEY);
    if (!raw) {
      return {
        ...DEFAULT_VIEW_SETTINGS,
        fontSize: readerFontSize || DEFAULT_VIEW_SETTINGS.fontSize,
      };
    }
    const parsed = JSON.parse(raw) as Partial<ReaderViewSettings>;
    return {
      ...DEFAULT_VIEW_SETTINGS,
      ...parsed,
      fontSize:
        typeof parsed.fontSize === 'number'
          ? clamp(parsed.fontSize, 12, 30)
          : readerFontSize || DEFAULT_VIEW_SETTINGS.fontSize,
      lineHeight:
        typeof parsed.lineHeight === 'number'
          ? clamp(parsed.lineHeight, 1.2, 2.4)
          : DEFAULT_VIEW_SETTINGS.lineHeight,
      contentWidth:
        typeof parsed.contentWidth === 'number'
          ? clamp(parsed.contentWidth, 36, 84)
          : DEFAULT_VIEW_SETTINGS.contentWidth,
      cjkLetterSpacing:
        typeof parsed.cjkLetterSpacing === 'number'
          ? clamp(parsed.cjkLetterSpacing, 0.02, 0.12)
          : DEFAULT_VIEW_SETTINGS.cjkLetterSpacing,
      theme:
        parsed.theme === 'white' ||
        parsed.theme === 'paper' ||
        parsed.theme === 'mint' ||
        parsed.theme === 'sepia' ||
        parsed.theme === 'night'
          ? parsed.theme
          : DEFAULT_VIEW_SETTINGS.theme,
      layoutMode:
        parsed.layoutMode === 'single' || parsed.layoutMode === 'double'
          ? parsed.layoutMode
          : DEFAULT_VIEW_SETTINGS.layoutMode,
      bilingualViewMode:
        parsed.bilingualViewMode === 'both' ||
        parsed.bilingualViewMode === 'source' ||
        parsed.bilingualViewMode === 'translation'
          ? parsed.bilingualViewMode
          : DEFAULT_VIEW_SETTINGS.bilingualViewMode,
    };
  } catch {
    return {
      ...DEFAULT_VIEW_SETTINGS,
      fontSize: readerFontSize || DEFAULT_VIEW_SETTINGS.fontSize,
    };
  }
};
