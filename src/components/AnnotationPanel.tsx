import { useEffect, useMemo, useState } from 'react';
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
      <div className="p-4 text-sm text-gray-500">Loading annotations...</div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Annotations & Highlights</h3>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{annotations.length}</span>
      </div>

      {annotations.length === 0 ? (
        <p className="text-sm text-gray-500">No annotations yet. Select text to create one.</p>
      ) : (
        <div className="space-y-2">
          {annotations.map((item) => (
            <div key={item.id} className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded bg-white px-2 py-0.5 text-xs text-gray-700">
                  {annotationStyleLabel[item.style]}
                </span>
                <button
                  onClick={() => setFocusedParagraphId(item.paragraph_id)}
                  className="text-xs text-blue-600 underline-offset-2 hover:underline"
                >
                  Go to Location
                </button>
                <button
                  onClick={() => void handleDelete(item.id)}
                  className="ml-auto text-xs text-rose-600 underline-offset-2 hover:underline"
                >
                  Delete
                </button>
              </div>
              <p className="text-sm text-gray-800">"{item.selected_text}"</p>
              {item.note && item.note.trim().length > 0 && (
                <p className="mt-1 text-xs text-amber-800">Note: {item.note}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
