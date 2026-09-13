import { describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => [initial, vi.fn()],
}));

import { useReaderPanelLayout } from './useReaderPanelLayout';

describe('useReaderPanelLayout', () => {
  it('opens with the reading viewport primary and the tool workspace collapsed', () => {
    const layout = useReaderPanelLayout();

    expect(layout.tocCollapsed).toBe(false);
    expect(layout).not.toHaveProperty('headerToolsCollapsed');
    expect(layout.toolCollapsed).toBe(true);
    expect([layout.tocCollapsed, layout.toolCollapsed]).not.toEqual([false, false]);
  });
});
