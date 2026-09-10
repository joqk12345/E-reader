import { describe, expect, it } from 'vitest';
import {
  foliatePositionKey,
  formatFoliateLocation,
  getTocSubitems,
  isAllowedExternalLink,
  type FoliateTocItem,
} from './foliateModel';

describe('foliate model adapter', () => {
  it('preserves nested TOC items instead of flattening the publication navigation', () => {
    const children: FoliateTocItem[] = [
      { label: 'Section 1.1', href: 'chapter-1.xhtml#section-1' },
    ];
    const parent: FoliateTocItem = {
      label: 'Chapter 1',
      href: 'chapter-1.xhtml',
      subitems: children,
    };

    expect(getTocSubitems(parent)).toBe(children);
    expect(getTocSubitems({ label: 'Leaf' })).toEqual([]);
  });

  it.each([
    ['book-1', 'reader:foliate-spike:position:book-1'],
    ['书籍-2', 'reader:foliate-spike:position:书籍-2'],
  ])('creates a deterministic per-document position key for %s', (documentId, expected) => {
    expect(foliatePositionKey(documentId)).toBe(expected);
  });

  it('allows user-initiated web and mail links but blocks active or local URL schemes', () => {
    for (const href of ['https://example.com/read', 'http://localhost:8080/note', 'mailto:reader@example.com']) {
      expect(isAllowedExternalLink(href)).toBe(true);
    }
    for (const href of [
      'javascript:document.body.dataset.pwned="true"',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'blob:https://example.com/id',
      '  ',
      'not an absolute URL',
    ]) {
      expect(isAllowedExternalLink(href)).toBe(false);
    }
  });

  it('formats the chapter and discrete publication position when both are available', () => {
    expect(
      formatFoliateLocation({
        tocItem: { label: '  Chapter 3  ' },
        location: { current: 12, total: 80 },
        fraction: 0.9,
      })
    ).toBe('Chapter 3 · 12/80');
  });

  it('falls back to rounded section progress without inventing a chapter label', () => {
    expect(formatFoliateLocation({ fraction: 0.426 })).toBe('43%');
  });

  it('keeps zero-valued progress observable and returns an empty label when unknown', () => {
    expect(formatFoliateLocation({ location: { current: 0, total: 80 } })).toBe('0/80');
    expect(formatFoliateLocation({})).toBe('');
  });
});
