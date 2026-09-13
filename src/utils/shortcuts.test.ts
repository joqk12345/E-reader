import { describe, expect, it } from 'vitest';
import { defaultKeymap, matchesShortcut, normalizeKeymap } from './shortcuts';

describe('reading keymap', () => {
  it('uses the standard right/left arrows for next and previous page', () => {
    expect(defaultKeymap.next_page).toContain('ArrowRight');
    expect(defaultKeymap.prev_page).toContain('ArrowLeft');
    expect(matchesShortcut({ key: 'ArrowRight', code: 'ArrowRight', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false } as KeyboardEvent, 'ArrowRight')).toBe(true);
    expect(matchesShortcut({ key: 'ArrowLeft', code: 'ArrowLeft', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false } as KeyboardEvent, 'ArrowLeft')).toBe(true);
  });

  it('adds arrow navigation when loading an older saved keymap', () => {
    const keymap = normalizeKeymap({ next_page: ['J'], prev_page: ['K'] });
    expect(keymap.next_page).toEqual(['J', 'ArrowRight']);
    expect(keymap.prev_page).toEqual(['K', 'ArrowLeft']);
  });

  it('keeps modifiers strict for configurable shortcuts', () => {
    const event = { key: '=', code: 'Equal', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } as KeyboardEvent;
    expect(matchesShortcut(event, 'Cmd+=')).toBe(true);
    expect(matchesShortcut({ ...event, shiftKey: true }, 'Cmd+=')).toBe(false);
  });
});
