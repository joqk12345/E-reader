import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./SearchPanel', () => ({ SearchPanel: () => <div data-testid="search-panel" /> }));

import { SemanticSearchHome } from './SemanticSearchHome';

describe('SemanticSearchHome', () => {
  it('keeps the empty search landing surface single-column and omits empty history chrome', () => {
    const markup = renderToStaticMarkup(<SemanticSearchHome />);

    expect(markup).toContain('data-testid="semantic-search-page"');
    expect(markup).not.toContain('lg:grid-cols-[280px_minmax(0,1fr)]');
    expect(markup).not.toContain('Recent Queries');
    expect(markup).toContain('data-testid="search-panel"');
  });
});
