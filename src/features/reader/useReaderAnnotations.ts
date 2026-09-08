import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Annotation, Paragraph } from '../../types';

export function useReaderAnnotations(paragraphs: Paragraph[], refreshToken = 0) {
  const [annotationsByParagraph, setAnnotationsByParagraph] = useState<Record<string, Annotation[]>>({});

  useEffect(() => {
    const paragraphIds = paragraphs.map((item) => item.id);
    if (paragraphIds.length === 0) {
      setAnnotationsByParagraph({});
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const rows = await invoke<Annotation[]>('list_annotations', { paragraphIds });
        if (cancelled) return;
        const grouped: Record<string, Annotation[]> = {};
        rows.forEach((item) => {
          (grouped[item.paragraph_id] ||= []).push(item);
        });
        setAnnotationsByParagraph(grouped);
      } catch (error) {
        console.error('Failed to load annotations:', error);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [paragraphs, refreshToken]);

  return { annotationsByParagraph, setAnnotationsByParagraph };
}
