import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReaderRange, ReaderSelect } from './ReaderControls';

describe('ReaderControls', () => {
  it('renders tokenized reader select and range controls with accessible labels', () => {
    const markup = renderToStaticMarkup(
      <div>
        <ReaderSelect aria-label="Reading theme" value="paper" onChange={() => undefined}>
          <option value="paper">Paper</option>
        </ReaderSelect>
        <ReaderRange aria-label="Text size" type="range" min="12" max="30" value={18} onChange={() => undefined} />
      </div>,
    );

    expect(markup).toContain('aria-label="Reading theme"');
    expect(markup).toContain('aria-label="Text size"');
    expect(markup).toContain('border-control-border');
  });
});
