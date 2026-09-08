import { useEffect, useMemo, useState } from 'react';
import { PanelButton } from './ui/Button';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';
import type { Annotation, AnnotationStyle } from '../types';

const annotationStyleLabel: Record<AnnotationStyle, string> = {
  single_underline: 'Single Underline',
  double_underline: 'Double Underline',
  wavy_strikethrough: 'Wavy Strikethrough',
};

export function AnnotationPanel() {
  const { paragraphs, setFocusedParagraphId } = useStore();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const paragraphIds = useMemo(() => paragraphs.map((item) => item.id), [paragraphs]);
  const paragraphIdsKey = useMemo(() => paragraphIds.join('|'), [paragraphIds]);

  const loadAnnotations = async () => {
    if (paragraphIds.length === 0) {
      setAnnotations([]);
      return;
    }
    setIsLoading(true);
    try {
      const rows = await invoke<Annotation[]>('list_annotations', { paragraphIds });
      setAnnotations(rows.sort((a, b) => b.created_at - a.created_at));
    } catch (error) {
      console.error('Failed to load annotations:', error);
      setAnnotations([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAnnotations();
  }, [paragraphIdsKey]);

  useEffect(() => {
    const onChanged = () => {
      void loadAnnotations();
    };
    window.addEventListener('reader:annotations-changed', onChanged as EventListener);
    return () => window.removeEventListener('reader:annotations-changed', onChanged as EventListener);
  }, [paragraphIdsKey]);

  const handleDelete = async (id: string) => {
    try {
      await invoke('delete_annotation', { id });
      setAnnotations((prev) => prev.filter((item) => item.id !== id));
      window.dispatchEvent(new CustomEvent('reader:annotations-changed'));
    } catch (error) {
      console.error('Failed to delete annotation:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 text-size-subheading text-muted">Loading annotations...</div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-size-subheading font-semibold text-foreground">Annotations & Highlights</h3>
        <span className="rounded bg-surface-subtle px-2 py-0.5 text-size-caption text-navigation">{annotations.length}</span>
      </div>

      {annotations.length === 0 ? (
        <p className="text-size-subheading text-muted">No annotations yet. Select text to create one.</p>
      ) : (
        <div className="space-y-2">
          {annotations.map((item) => (
            <div key={item.id} className="rounded border border-border bg-surface-subtle px-3 py-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded bg-surface px-2 py-0.5 text-size-caption text-secondary">
                  {annotationStyleLabel[item.style]}
                </span>
                <PanelButton
                  onClick={() => setFocusedParagraphId(item.paragraph_id)}
                  className="text-size-caption text-action underline-offset-2 hover:underline"
                >
                  Go to Location
                </PanelButton>
                <PanelButton
                  onClick={() => void handleDelete(item.id)}
                  className="ml-auto text-size-caption text-danger underline-offset-2 hover:underline"
                >
                  Delete
                </PanelButton>
              </div>
              <p className="text-size-subheading text-foreground">"{item.selected_text}"</p>
              {item.note && item.note.trim().length > 0 && (
                <p className="mt-1 text-size-caption text-warning">Note: {item.note}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
