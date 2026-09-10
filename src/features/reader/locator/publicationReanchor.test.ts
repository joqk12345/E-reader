import { describe, expect, it } from 'vitest';
import { resolvePublicationLocator, type PublicationLocatorResolution } from './publicationReanchor';
import type { PublicationLocatorV1 } from './publicationLocator';

const makeLocator = (overrides: Partial<PublicationLocatorV1> = {}): PublicationLocatorV1 => ({
  schemaVersion: 1,
  publicationId: 'publication-1',
  sourceHash: 'a'.repeat(64),
  href: 'EPUB/chapter.xhtml',
  locations: { cssSelector: '#target' },
  text: { before: 'before ', highlight: 'same text', after: ' after' },
  ...overrides,
});

const resolve = (locator: PublicationLocatorV1, text: string): PublicationLocatorResolution =>
  resolvePublicationLocator({
    locator,
    identity: {
      publicationId: 'publication-1',
      sourceHash: 'a'.repeat(64),
      href: 'EPUB/chapter.xhtml',
    },
    href: 'EPUB/chapter.xhtml',
    text,
  });

describe('resolvePublicationLocator', () => {
  it('uses a verified CFI as the exact primary anchor', () => {
    const result = resolvePublicationLocator({
      locator: makeLocator({ locations: { cfi: 'epubcfi(/6/4!/4/2)' } }),
      href: 'EPUB/chapter.xhtml',
      text: 'ignored',
      resolveCfi: () => ({ start: 2, end: 6, text: 'same' }),
    });
    expect(result).toMatchObject({ status: 'exact', strategy: 'cfi', match: { start: 2, end: 6 } });
  });

  it('reanchors unique quotes while collapsing Unicode whitespace', () => {
    const result = resolve(makeLocator(), 'prefix before\n\u00a0same   text after suffix');
    expect(result).toMatchObject({ status: 'reanchored', strategy: 'quote' });
    expect(result.match?.text).toBe('same   text');
  });

  it('uses bounded context to disambiguate repeated quotes', () => {
    const result = resolve(
      makeLocator({ text: { before: 'right ', highlight: 'same text', after: ' end' } }),
      'left same text end; right same text end'
    );
    expect(result).toMatchObject({ status: 'reanchored', strategy: 'quote' });
    expect(result.match?.start).toBe('left same text end; '.length + 'right '.length);
  });

  it('reports ambiguous repeated quotes instead of guessing', () => {
    const result = resolve(
      makeLocator({ text: { highlight: 'same text' } }),
      'same text ... same text'
    );
    expect(result).toMatchObject({ status: 'ambiguous', diagnostic: { code: 'quote_ambiguous' } });
  });

  it('returns a nearby-quote result when context changed but the quote is unique', () => {
    const result = resolve(makeLocator(), 'unrelated prefix same text unrelated suffix');
    expect(result).toMatchObject({ status: 'reanchored', strategy: 'nearby-quote' });
  });

  it('falls back to approximate position and progression in that order', () => {
    expect(resolve(makeLocator({ text: undefined, locations: { position: 4 } }), 'abcdef')).toMatchObject({
      status: 'approximate',
      strategy: 'position',
      match: { start: 3, end: 3 },
    });
    expect(resolve(makeLocator({ text: undefined, locations: { progression: 0.5 } }), 'abcdef')).toMatchObject({
      status: 'approximate',
      strategy: 'progression',
      match: { start: 2, end: 2 },
    });
  });

  it('refuses identity or href mismatches and does not cross publications', () => {
    expect(resolve(makeLocator({ href: 'EPUB/other.xhtml' }), 'same text')).toMatchObject({
      status: 'unresolved',
      diagnostic: { code: 'locator_invalid' },
    });
    expect(
      resolvePublicationLocator({
        locator: makeLocator(),
        href: 'EPUB/other.xhtml',
        text: 'same text',
      })
    ).toMatchObject({ status: 'unresolved', diagnostic: { code: 'href_mismatch' } });
  });

  it('returns href-only approximate recovery when no precise evidence exists', () => {
    expect(resolve(makeLocator({ text: undefined, locations: { cssSelector: '#missing' } }), '')).toEqual({
      status: 'approximate',
      strategy: 'href',
    });
  });
});
