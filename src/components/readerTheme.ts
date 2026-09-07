export type ReaderThemeId = 'white' | 'paper' | 'mint' | 'sepia' | 'night';

export type ReaderSyntaxTokens = {
  base: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  function: string;
  property: string;
  boolean: string;
  muted: string;
  quote: string;
};

const LIGHT_SYNTAX: ReaderSyntaxTokens = {
  base: '#1f2937',
  keyword: '#8b1d1d',
  string: '#166534',
  number: '#7c3aed',
  comment: '#64748b',
  function: '#1d4ed8',
  property: '#0f766e',
  boolean: '#b45309',
  muted: '#4b5563',
  quote: '#374151',
};

const DARK_SYNTAX: ReaderSyntaxTokens = {
  base: '#d6d9de',
  keyword: '#f38ba8',
  string: '#a6e3a1',
  number: '#f9e2af',
  comment: '#94a3b8',
  function: '#89b4fa',
  property: '#94e2d5',
  boolean: '#fab387',
  muted: '#9ca3af',
  quote: '#b6bcc7',
};

export type ReaderViewSettings = {
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  theme: ReaderThemeId;
  layoutMode: 'single' | 'double';
  bilingualViewMode: 'both' | 'source' | 'translation';
  markdownRenderMode: 'text' | 'multimedia';
  cjkLetterSpacingEnabled: boolean;
  cjkLetterSpacing: number;
  expandDetails: boolean;
};

export const VIEW_SETTINGS_KEY = 'vmark-reader-settings';
// Kept for backwards compatibility with the persisted Tauri config format.
export const LEGACY_READER_BACKGROUND = '#F4F8EE';

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
    syntax: ReaderSyntaxTokens;
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
    syntax: LIGHT_SYNTAX,
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
    syntax: LIGHT_SYNTAX,
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
    syntax: LIGHT_SYNTAX,
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
    syntax: LIGHT_SYNTAX,
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
    syntax: DARK_SYNTAX,
  },
};

export const DEFAULT_VIEW_SETTINGS: ReaderViewSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  contentWidth: 56,
  theme: 'paper',
  layoutMode: 'single',
  bilingualViewMode: 'both',
  markdownRenderMode: 'text',
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
          ? clamp(parsed.contentWidth, 36, 120)
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
      markdownRenderMode:
        parsed.markdownRenderMode === 'text' ||
        parsed.markdownRenderMode === 'multimedia'
          ? parsed.markdownRenderMode
          : DEFAULT_VIEW_SETTINGS.markdownRenderMode,
    };
  } catch {
    return {
      ...DEFAULT_VIEW_SETTINGS,
      fontSize: readerFontSize || DEFAULT_VIEW_SETTINGS.fontSize,
    };
  }
};
