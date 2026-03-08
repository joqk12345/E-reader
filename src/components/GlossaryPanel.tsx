import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  loadTermGlossary,
  normalizeStringArray,
  saveTermGlossary,
  TERM_GLOSSARY_CHANGED_EVENT,
  type TermGlossaryEntry,
} from './termGlossary';

const formatTime = (value: number) => new Date(value).toLocaleString();

export const GlossaryPanel: React.FC = () => {
  const { selectedDocumentId, documents } = useStore();
  const [entries, setEntries] = useState<TermGlossaryEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const refresh = () => {
    setEntries(loadTermGlossary());
    setIsLoaded(true);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener(TERM_GLOSSARY_CHANGED_EVENT, onChanged as EventListener);
    return () => window.removeEventListener(TERM_GLOSSARY_CHANGED_EVENT, onChanged as EventListener);
  }, []);

  const visibleEntries = useMemo(() => {
    const source = selectedDocumentId
      ? entries.filter((item) => item.docId === selectedDocumentId)
      : entries;
    return [...source].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [entries, selectedDocumentId]);

  const targetLabel = useMemo(() => {
    if (!selectedDocumentId) return 'All Documents';
    return documents.find((item) => item.id === selectedDocumentId)?.title || selectedDocumentId;
  }, [documents, selectedDocumentId]);

  const persist = (nextEntries: TermGlossaryEntry[]) => {
    setEntries(nextEntries);
    if (isLoaded) {
      saveTermGlossary(nextEntries);
    }
  };

  const updateEntry = (docId: string, termKey: string, patch: Partial<TermGlossaryEntry>) => {
    persist(
      entries.map((item) =>
        item.docId === docId && item.termKey === termKey
          ? { ...item, ...patch, updatedAt: Date.now() }
          : item,
      ),
    );
  };

  const deleteEntry = (docId: string, termKey: string) => {
    persist(entries.filter((item) => !(item.docId === docId && item.termKey === termKey)));
  };

  const clearVisibleEntries = () => {
    if (selectedDocumentId) {
      persist(entries.filter((item) => item.docId !== selectedDocumentId));
      return;
    }
    persist([]);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-gray-600">
              Scope: <span className="font-medium text-gray-900">{targetLabel}</span>
            </div>
            <div className="mt-1 text-xs text-gray-500">{visibleEntries.length} glossary entries</div>
          </div>
          <button
            onClick={clearVisibleEntries}
            disabled={visibleEntries.length === 0}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear Scope
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {visibleEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">
            No glossary entries yet. Pin a preferred rendering from the Term panel first.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleEntries.map((entry) => (
              <div key={`${entry.docId}:${entry.termKey}`} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{entry.term}</div>
                    <div className="mt-1 text-xs text-gray-500">{formatTime(entry.updatedAt)}</div>
                  </div>
                  <button
                    onClick={() => deleteEntry(entry.docId, entry.termKey)}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>

                <div className="mt-3">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Preferred Rendering
                  </label>
                  <input
                    value={entry.preferredRendering}
                    onChange={(event) =>
                      updateEntry(entry.docId, entry.termKey, {
                        preferredRendering: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="mt-3">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Concept Tags
                  </label>
                  <input
                    value={entry.conceptTags.join(', ')}
                    onChange={(event) =>
                      updateEntry(entry.docId, entry.termKey, {
                        conceptTags: normalizeStringArray(
                          event.target.value
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        ),
                      })
                    }
                    placeholder="epistemology, ethics, political theory"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
