import { describe, expect, it } from 'vitest';
import {
  LOCATOR_QUOTE_CONTEXT_CHARS,
  parsePublicationLocatorV1,
  type PublicationLocatorV1,
} from './publicationLocator';

const locator = (): PublicationLocatorV1 => ({
  schemaVersion: 1,
  publicationId: 'publication-1',
  sourceHash: 'a'.repeat(64),
  href: 'EPUB/chapter.xhtml',
  type: 'application/xhtml+xml',
  locations: { cssSelector: 'body > p:nth-of-type(1)' },
  text: { before: 'Before', highlight: 'Exact text', after: 'After' },
});

describe('PublicationLocatorV1', () => {
  it('parses the shared contract and validates its publication identity', () => {
    expect(
      parsePublicationLocatorV1(locator(), {
        publicationId: 'publication-1',
        sourceHash: 'a'.repeat(64),
        href: 'EPUB/chapter.xhtml',
      })
    ).toEqual(locator());
  });

  it('rejects cross-publication, source, and href application', () => {
    expect(() =>
      parsePublicationLocatorV1(locator(), {
        publicationId: 'other',
        sourceHash: 'a'.repeat(64),
        href: 'EPUB/chapter.xhtml',
      })
    ).toThrow('publication identity');
    expect(() =>
      parsePublicationLocatorV1(locator(), {
        publicationId: 'publication-1',
        sourceHash: 'b'.repeat(64),
        href: 'EPUB/chapter.xhtml',
      })
    ).toThrow('source hash');
    expect(() =>
      parsePublicationLocatorV1(locator(), {
        publicationId: 'publication-1',
        sourceHash: 'a'.repeat(64),
        href: 'EPUB/other.xhtml',
      })
    ).toThrow('href');
  });

  it('rejects malformed numbers, hrefs, quote bounds, and missing anchors', () => {
    for (const invalid of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        parsePublicationLocatorV1({
          ...locator(),
          locations: { progression: invalid },
        })
      ).toThrow('[0, 1]');
    }
    for (const href of ['https://example.com/book', '../escape.xhtml', '/absolute.xhtml', 'EPUB/%2Fescape']) {
      expect(() => parsePublicationLocatorV1({ ...locator(), href })).toThrow('href');
    }
    expect(() =>
      parsePublicationLocatorV1({
        ...locator(),
        locations: {},
        text: undefined,
      })
    ).toThrow('no usable anchor');
    expect(() =>
      parsePublicationLocatorV1({
        ...locator(),
        text: { highlight: 'Exact', before: '前'.repeat(LOCATOR_QUOTE_CONTEXT_CHARS + 1) },
      })
    ).toThrow('context bound');
    expect(() =>
      parsePublicationLocatorV1({
        ...locator(),
        text: { highlight: '   ' },
      })
    ).toThrow('highlight is empty');
  });

  it('rejects unknown fields at every DTO layer', () => {
    expect(() => parsePublicationLocatorV1({ ...locator(), unknown: true })).toThrow(
      'Unknown locator field'
    );
    expect(() =>
      parsePublicationLocatorV1({
        ...locator(),
        locations: { ...locator().locations, unknown: true },
      })
    ).toThrow('Unknown locations field');
    expect(() =>
      parsePublicationLocatorV1({
        ...locator(),
        text: { ...locator().text, unknown: true },
      })
    ).toThrow('Unknown text field');
  });
});
