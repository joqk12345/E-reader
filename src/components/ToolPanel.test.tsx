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
  it('keeps only the three primary reading tasks at the first level while preserving every tool', () => {
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
    expect(markup).toContain('data-testid="reader-tool-group-primary"');
    expect(markup).toMatch(/reader-tool-group-primary[\s\S]*title="Search"[\s\S]*title="Understand"[\s\S]*title="Chat"/);
    expect(markup).toMatch(/reader-tool-group-advanced hidden[\s\S]*title="Summary"[\s\S]*title="Audio"/);
    expect(markup).not.toContain('reader-tool-icon');
  });
});
