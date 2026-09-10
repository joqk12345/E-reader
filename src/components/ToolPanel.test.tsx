import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./SearchPanel', () => ({ SearchPanel: () => null }));
vi.mock('./SummaryPanel', () => ({ SummaryPanel: () => null }));
vi.mock('./TranslatePanel', () => ({ TranslatePanel: () => null }));
vi.mock('./AudiobookPanel', () => ({ AudiobookPanel: () => null }));
vi.mock('./DeepAnalysisPanel', () => ({ DeepAnalysisPanel: () => null }));
vi.mock('./ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('./NotesPanel', () => ({ NotesPanel: () => null }));
vi.mock('./AnnotationPanel', () => ({ AnnotationPanel: () => null }));
vi.mock('./DictPanel', () => ({ DictPanel: () => null }));
vi.mock('./UnderstandPanel', () => ({ UnderstandPanel: () => null }));
vi.mock('./GlossaryPanel', () => ({ GlossaryPanel: () => null }));
vi.mock('./TagsPanel', () => ({ TagsPanel: () => null }));

import { ToolPanel } from './ToolPanel';

describe('ToolPanel', () => {
  it('keeps every tool discoverable in an accessible non-grid tab rail', () => {
    const markup = renderToStaticMarkup(
      <ToolPanel
        collapsed={false}
        width={320}
        minWidth={280}
        maxWidth={460}
        onToggleCollapse={() => undefined}
        onWidthChange={() => undefined}
      />
    );

    expect(markup).toContain('aria-label="Reader tools"');
    expect(markup).not.toContain('grid-cols-3');
    for (const label of ['Search', 'Understand', 'Notes', 'Translate', 'Dict', 'Audio']) {
      expect(markup).toContain(`title="${label}"`);
    }
  });
});
