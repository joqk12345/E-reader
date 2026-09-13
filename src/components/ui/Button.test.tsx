import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('uses shared tokenized surface classes for size and focus states', () => {
    const markup = renderToStaticMarkup(
      <Button variant="primary" size="sm" disabled>
        Save
      </Button>
    );

    expect(markup).toContain('ui-button-sm');
    expect(markup).toContain('ui-button-primary');
    expect(markup).toContain('ui-button');
    expect(markup).toContain('disabled');
  });
});
