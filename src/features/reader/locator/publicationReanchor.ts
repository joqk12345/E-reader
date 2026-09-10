import {
  parsePublicationLocatorV1,
  type LocatorIdentity,
  type PublicationLocatorV1,
} from './publicationLocator';

export type LocatorResolutionStatus =
  | 'exact'
  | 'reanchored'
  | 'approximate'
  | 'ambiguous'
  | 'unresolved';

export type LocatorResolutionStrategy =
  | 'cfi'
  | 'selector-quote'
  | 'quote'
  | 'nearby-quote'
  | 'position'
  | 'progression'
  | 'href';

export type PublicationTextMatch = {
  start: number;
  end: number;
  text: string;
};

export type PublicationLocatorResolution = {
  status: LocatorResolutionStatus;
  strategy?: LocatorResolutionStrategy;
  match?: PublicationTextMatch;
  diagnostic?: { code: string; message: string };
};

export type PublicationReanchorInput = {
  locator: PublicationLocatorV1;
  identity?: LocatorIdentity;
  href: string;
  text: string;
  /** The EPUB adapter owns CFI parsing and can report a verified DOM match. */
  resolveCfi?: (cfi: string) => PublicationTextMatch | null;
  /** The EPUB adapter owns selector resolution and can report a verified DOM match. */
  resolveSelector?: (selector: string) => PublicationTextMatch | null;
};

type NormalizedText = {
  value: string;
  /** Maps every normalized UTF-16 boundary to a source UTF-16 boundary. */
  sourceBoundaries: number[];
};

const whitespace = /\s/u;

const normalizeText = (value: string): NormalizedText => {
  let normalized = '';
  const sourceBoundaries = [0];
  let pendingSpace = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (whitespace.test(character)) {
      pendingSpace = normalized.length > 0;
      continue;
    }
    if (pendingSpace) {
      normalized += ' ';
      sourceBoundaries.push(index);
      pendingSpace = false;
    }
    normalized += character;
    sourceBoundaries.push(index + 1);
  }

  return { value: normalized, sourceBoundaries };
};

const normalizedBoundary = (text: NormalizedText, index: number): number =>
  text.sourceBoundaries[Math.max(0, Math.min(index, text.sourceBoundaries.length - 1))];

const findOccurrences = (text: string, needle: string): number[] => {
  if (!needle) return [];
  const results: number[] = [];
  let fromIndex = 0;
  while (fromIndex <= text.length - needle.length) {
    const index = text.indexOf(needle, fromIndex);
    if (index < 0) break;
    results.push(index);
    fromIndex = index + 1;
  }
  return results;
};

const contextMatches = (
  source: string,
  start: number,
  end: number,
  before: string | undefined,
  after: string | undefined
): boolean => {
  const normalizedSource = normalizeText(source).value;
  // Context is stored as a bounded slice and may begin/end inside whitespace.
  // Trim only the matching edge; the highlighted text itself remains exact.
  const normalizedBefore = before ? normalizeText(before).value.trim() : '';
  const normalizedAfter = after ? normalizeText(after).value.trim() : '';
  return (
    (!normalizedBefore || normalizedSource.slice(0, start).trimEnd().endsWith(normalizedBefore)) &&
    (!normalizedAfter || normalizedSource.slice(end).trimStart().startsWith(normalizedAfter))
  );
};

const makeMatch = (
  source: string,
  normalizedSource: NormalizedText,
  start: number,
  end: number
): PublicationTextMatch => {
  const sourceStart = normalizedBoundary(normalizedSource, start);
  const sourceEnd = normalizedBoundary(normalizedSource, end);
  return { start: sourceStart, end: sourceEnd, text: source.slice(sourceStart, sourceEnd) };
};

const diagnostic = (code: string, message: string): PublicationLocatorResolution => ({
  status: 'unresolved',
  diagnostic: { code, message },
});

/**
 * Resolves a persisted V1 locator without changing it or silently crossing publication identity.
 * Exact CFI/selector resolution is delegated to the EPUB adapter; text fallback is deterministic
 * and only returns a precise match when the quote/context evidence is sufficient.
 */
export const resolvePublicationLocator = (
  input: PublicationReanchorInput
): PublicationLocatorResolution => {
  let locator: PublicationLocatorV1;
  try {
    locator = parsePublicationLocatorV1(input.locator, input.identity);
  } catch (error) {
    return diagnostic('locator_invalid', error instanceof Error ? error.message : String(error));
  }
  if (locator.href !== input.href) {
    return diagnostic('href_mismatch', 'Locator href does not match the rendered spine item');
  }

  const cfi = locator.locations.cfi?.trim();
  if (cfi && input.resolveCfi) {
    const match = input.resolveCfi(cfi);
    if (match) return { status: 'exact', strategy: 'cfi', match };
  }

  const selector = locator.locations.cssSelector?.trim();
  if (selector && input.resolveSelector) {
    const match = input.resolveSelector(selector);
    if (match) return { status: 'exact', strategy: 'selector-quote', match };
  }

  const normalizedSource = normalizeText(input.text);
  const highlight = locator.text?.highlight;
  const normalizedHighlight = highlight ? normalizeText(highlight).value : '';
  if (normalizedHighlight) {
    const occurrences = findOccurrences(normalizedSource.value, normalizedHighlight);
    const contextCandidates = occurrences.filter((start) =>
      contextMatches(
        normalizedSource.value,
        start,
        start + normalizedHighlight.length,
        locator.text?.before,
        locator.text?.after
      )
    );
    if (contextCandidates.length === 1) {
      const start = contextCandidates[0];
      return {
        status: 'reanchored',
        strategy: 'quote',
        match: makeMatch(input.text, normalizedSource, start, start + normalizedHighlight.length),
      };
    }
    if (contextCandidates.length > 1 || (contextCandidates.length === 0 && occurrences.length > 1)) {
      return {
        status: 'ambiguous',
        diagnostic: {
          code: 'quote_ambiguous',
          message: `Locator quote matched ${occurrences.length} times and context did not disambiguate it`,
        },
      };
    }
    if (occurrences.length === 1) {
      const start = occurrences[0];
      return {
        status: 'reanchored',
        strategy: 'nearby-quote',
        match: makeMatch(input.text, normalizedSource, start, start + normalizedHighlight.length),
      };
    }
  }

  if (typeof locator.locations.position === 'number' && input.text.length > 0) {
    const start = Math.min(input.text.length - 1, locator.locations.position - 1);
    return {
      status: 'approximate',
      strategy: 'position',
      match: { start, end: start, text: '' },
    };
  }
  if (typeof locator.locations.progression === 'number' && input.text.length > 0) {
    const start = Math.floor(locator.locations.progression * Math.max(0, input.text.length - 1));
    return {
      status: 'approximate',
      strategy: 'progression',
      match: { start, end: start, text: '' },
    };
  }
  return { status: 'approximate', strategy: 'href' };
};
