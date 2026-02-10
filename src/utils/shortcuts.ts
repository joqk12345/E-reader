export type Keymap = {
  next_page: string[];
  prev_page: string[];
  open_settings: string[];
};

export const defaultKeymap: Keymap = {
  next_page: ['PageDown', 'Space', 'J'],
  prev_page: ['PageUp', 'Shift+Space', 'K'],
  open_settings: ['Cmd+,', 'Ctrl+,'],
};

const normalizeKeyToken = (token: string): string => {
  const lower = token.trim().toLowerCase();
  if (lower === 'pgdown' || lower === 'pagedown' || lower === 'next') return 'pagedown';
  if (lower === 'pgup' || lower === 'pageup' || lower === 'prior') return 'pageup';
  if (lower === 'space' || lower === 'spacebar') return 'space';
  if (lower === 'cmd' || lower === 'command' || lower === 'meta') return 'meta';
  if (lower === 'ctrl' || lower === 'control') return 'ctrl';
  if (lower === 'option') return 'alt';
  return lower;
};

const parseShortcut = (shortcut: string) => {
  const tokens = shortcut
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeKeyToken);
  if (tokens.length === 0) return null;
  const key = tokens[tokens.length - 1];
  const modifiers = new Set(tokens.slice(0, -1));
  return { key, modifiers };
};

const eventMatchesKey = (event: KeyboardEvent, expected: string): boolean => {
  const key = event.key.toLowerCase();
  const code = event.code.toLowerCase();

  if (expected === 'pagedown') return key === 'pagedown' || key === 'next' || code === 'pagedown';
  if (expected === 'pageup') return key === 'pageup' || key === 'prior' || code === 'pageup';
  if (expected === 'space') return key === ' ' || key === 'spacebar' || code === 'space';
  if (expected === ',') return key === ',' || code === 'comma';
  return key === expected || code === expected;
};

export const matchesShortcut = (event: KeyboardEvent, shortcut: string): boolean => {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;

  const requiresMeta = parsed.modifiers.has('meta');
  const requiresCtrl = parsed.modifiers.has('ctrl');
  const requiresAlt = parsed.modifiers.has('alt');
  const requiresShift = parsed.modifiers.has('shift');

  if (event.metaKey !== requiresMeta) return false;
  if (event.ctrlKey !== requiresCtrl) return false;
  if (event.altKey !== requiresAlt) return false;
  if (event.shiftKey !== requiresShift) return false;

  return eventMatchesKey(event, parsed.key);
};

export const matchesAnyShortcut = (event: KeyboardEvent, shortcuts: string[]): boolean => {
  return shortcuts.some((shortcut) => matchesShortcut(event, shortcut));
};

export const normalizeKeymap = (keymap?: Partial<Keymap> | null): Keymap => {
  return {
    next_page:
      keymap?.next_page && keymap.next_page.length > 0
        ? keymap.next_page
        : defaultKeymap.next_page,
    prev_page:
      keymap?.prev_page && keymap.prev_page.length > 0
        ? keymap.prev_page
        : defaultKeymap.prev_page,
    open_settings:
      keymap?.open_settings && keymap.open_settings.length > 0
        ? keymap.open_settings
        : defaultKeymap.open_settings,
  };
};

export const parseShortcutListInput = (value: string): string[] => {
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const formatShortcutListInput = (shortcuts: string[]): string => shortcuts.join('; ');
