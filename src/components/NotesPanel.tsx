import React, { useEffect, useMemo, useState } from 'react';
import { Textarea } from './ui/Textarea';
import { PanelButton } from './ui/Button';
import { useStore } from '../store/useStore';

type NoteRequest = {
  id: number;
  docId?: string;
  paragraphId?: string;
  selectedText: string;
  noteText?: string;
} | null;

type NoteItem = {
  id: string;
  docId: string;
  paragraphId?: string;
  selectedText: string;
  noteText: string;
  createdAt: number;
  updatedAt: number;
};

type NotesPanelProps = {
  request?: NoteRequest;
};

const STORAGE_KEY = 'reader_notes_v1';

const makeId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const formatTime = (ts: number) => new Date(ts).toLocaleString();

export const NotesPanel: React.FC<NotesPanelProps> = ({ request }) => {
  const { selectedDocumentId, documents } = useStore();
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as NoteItem[];
      if (Array.isArray(parsed)) {
        setNotes(parsed);
      }
    } catch (err) {
      console.warn('Failed to load notes from localStorage:', err);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    if (!request?.selectedText) return;
    const docId = request.docId || selectedDocumentId;
    if (!docId) return;
    const now = Date.now();
    const newNote: NoteItem = {
      id: makeId(),
      docId,
      paragraphId: request.paragraphId,
      selectedText: request.selectedText,
      noteText: request.noteText || '',
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [newNote, ...prev]);
  }, [request?.id, request?.docId, request?.paragraphId, request?.selectedText, request?.noteText, selectedDocumentId]);

  const currentDocNotes = useMemo(() => {
    if (!selectedDocumentId) return [];
    return notes
      .filter((n) => n.docId === selectedDocumentId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, selectedDocumentId]);

  const currentDocTitle = useMemo(() => {
    if (!selectedDocumentId) return 'No document selected';
    return documents.find((d) => d.id === selectedDocumentId)?.title || selectedDocumentId;
  }, [documents, selectedDocumentId]);

  const updateNoteText = (id: string, noteText: string) => {
    const now = Date.now();
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, noteText, updatedAt: now } : n))
    );
  };

  const deleteNote = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  };

  const exportJson = () => {
    if (!selectedDocumentId) return;
    const data = currentDocNotes;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reader-notes-${selectedDocumentId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMarkdown = async () => {
    if (!selectedDocumentId) return;
    const body = currentDocNotes
      .map((n, idx) => {
        const note = n.noteText.trim() || '_No note text_';
        return `## ${idx + 1}. Note\n\n- Time: ${formatTime(n.createdAt)}\n- Paragraph: ${n.paragraphId || 'N/A'}\n\n### Selected Text\n\n> ${n.selectedText}\n\n### My Note\n\n${note}`;
      })
      .join('\n\n---\n\n');
    const content = `# Notes for ${currentDocTitle}\n\n${body || '_No notes_'}`;
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.warn('Copy markdown failed:', err);
    }
  };

  const importFromJson = () => {
    setImportError(null);
    try {
      const parsed = JSON.parse(importText) as NoteItem[];
      if (!Array.isArray(parsed)) {
        throw new Error('JSON must be an array');
      }
      const normalized: NoteItem[] = parsed
        .filter((n) => n && typeof n.selectedText === 'string' && typeof n.docId === 'string')
        .map((n) => ({
          id: n.id || makeId(),
          docId: n.docId,
          paragraphId: n.paragraphId,
          selectedText: n.selectedText,
          noteText: n.noteText || '',
          createdAt: n.createdAt || Date.now(),
          updatedAt: n.updatedAt || Date.now(),
        }));
      setNotes((prev) => [...normalized, ...prev]);
      setImportText('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(msg || 'Import failed');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-size-subheading text-navigation">
            Notes Target: <span className="font-medium text-heading">{currentDocTitle}</span>
          </span>
          <span className="text-size-caption text-muted">{currentDocNotes.length} notes</span>
        </div>
        <div className="flex items-center gap-2">
          <PanelButton
            onClick={exportJson}
            disabled={!selectedDocumentId || currentDocNotes.length === 0}
            className="px-2 py-1 text-size-caption border border-control-border rounded hover:bg-surface-subtle disabled:bg-surface-subtle disabled:text-faint"
          >
            Export JSON
          </PanelButton>
          <PanelButton
            onClick={() => void exportMarkdown()}
            disabled={!selectedDocumentId || currentDocNotes.length === 0}
            className="px-2 py-1 text-size-caption border border-control-border rounded hover:bg-surface-subtle disabled:bg-surface-subtle disabled:text-faint"
          >
            Copy Markdown
          </PanelButton>
        </div>
      </div>

      <div className="p-3 border-b border-border space-y-2">
        <Textarea
          rows={3}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="Paste notes JSON for import..."
          className="w-full resize-none border border-control-border rounded px-2 py-1.5 text-size-subheading focus:outline-none focus:ring-2 focus:ring-focus"
        />
        <div className="flex items-center justify-between">
          <PanelButton
            onClick={importFromJson}
            disabled={!importText.trim()}
            className="px-2 py-1 text-size-caption border border-control-border rounded hover:bg-surface-subtle disabled:bg-surface-subtle disabled:text-faint"
          >
            Import JSON
          </PanelButton>
          {importError && <span className="text-size-caption text-danger">{importError}</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {!selectedDocumentId && (
          <div className="h-full flex items-center justify-center text-size-subheading text-muted">
            Please select a document first.
          </div>
        )}
        {selectedDocumentId && currentDocNotes.length === 0 && (
          <div className="h-full flex items-center justify-center text-size-subheading text-muted">
            No notes yet. Select text in Reader and click “笔记” in the popup toolbar.
          </div>
        )}
        {currentDocNotes.map((note) => (
          <div key={note.id} className="border border-border rounded-lg p-3 bg-surface">
            <div className="flex items-center justify-between mb-2">
              <span className="text-size-meta text-muted">{formatTime(note.updatedAt)}</span>
              <PanelButton
                onClick={() => deleteNote(note.id)}
                className="text-size-caption text-danger hover:text-danger"
              >
                Delete
              </PanelButton>
            </div>
            <blockquote className="text-size-subheading text-foreground border-l-2 border-action-subtle pl-2 mb-2 whitespace-pre-wrap">
              {note.selectedText}
            </blockquote>
            <Textarea
              rows={3}
              value={note.noteText}
              onChange={(e) => updateNoteText(note.id, e.target.value)}
              placeholder="Write your note..."
              className="w-full resize-none border border-control-border rounded px-2 py-1.5 text-size-subheading focus:outline-none focus:ring-2 focus:ring-focus"
            />
          </div>
        ))}
      </div>
    </div>
  );
};
