import { useCallback, useEffect, useState } from 'react';

export type SelectionAction =
  | 'simple' | 'context' | 'term' | 'dict' | 'takeaway' | 'ask'
  | 'play' | 'copy' | 'share' | 'highlight' | 'note';

export const ALL_SELECTION_ACTIONS: SelectionAction[] = [
  'simple', 'context', 'term', 'dict', 'takeaway', 'ask',
  'play', 'copy', 'share', 'highlight', 'note',
];

const normalizeSelectionActionOrder = (input: SelectionAction[]) => {
  const dedup = input.filter((item, index) => input.indexOf(item) === index);
  const valid = dedup.filter((item): item is SelectionAction => ALL_SELECTION_ACTIONS.includes(item));
  return [...valid, ...ALL_SELECTION_ACTIONS.filter((item) => !valid.includes(item))];
};

export function useSelectionActionOrder(storageKey = 'reader_selection_action_order') {
  const [selectionActionOrder, setSelectionActionOrder] = useState<SelectionAction[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? normalizeSelectionActionOrder(JSON.parse(raw) as SelectionAction[]) : ALL_SELECTION_ACTIONS;
    } catch {
      return ALL_SELECTION_ACTIONS;
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(selectionActionOrder));
    const normalized = normalizeSelectionActionOrder(selectionActionOrder);
    if (normalized.join('|') !== selectionActionOrder.join('|')) setSelectionActionOrder(normalized);
  }, [selectionActionOrder, storageKey]);

  const reorderSelectionActions = useCallback((from: SelectionAction, to: SelectionAction) => {
    if (from === to) return;
    setSelectionActionOrder((prev) => {
      const fromIndex = prev.indexOf(from);
      const toIndex = prev.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, from);
      return next;
    });
  }, []);

  return { selectionActionOrder, setSelectionActionOrder, reorderSelectionActions };
}
