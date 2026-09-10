export type FoliateTocItem = {
  label?: string;
  href?: string;
  subitems?: FoliateTocItem[];
};

export type FoliateRelocation = {
  cfi?: string;
  fraction?: number;
  location?: { current?: number; total?: number };
  tocItem?: { label?: string; href?: string };
  range?: Range;
};

export type FoliateLocatorQuote = {
  before?: string;
  highlight: string;
  after?: string;
};

const takeLastCharacters = (value: string, count: number): string =>
  Array.from(value).slice(-count).join('');

const takeFirstCharacters = (value: string, count: number): string =>
  Array.from(value).slice(0, count).join('');

/** Extract bounded text evidence from a foliate DOM range without persisting DOM objects. */
export const getFoliateLocatorQuote = (
  range: Range,
  contextCharacters = 48
): FoliateLocatorQuote | undefined => {
  const highlight = range.toString();
  if (!highlight.trim()) return undefined;
  const document = range.startContainer.ownerDocument;
  if (!document) return { highlight };
  const body = document.body;
  if (!body) return { highlight };

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(body);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(body);
  afterRange.setStart(range.endContainer, range.endOffset);
  return {
    before: takeLastCharacters(beforeRange.toString(), contextCharacters) || undefined,
    highlight,
    after: takeFirstCharacters(afterRange.toString(), contextCharacters) || undefined,
  };
};

export const getTocSubitems = (item: FoliateTocItem): FoliateTocItem[] =>
  Array.isArray(item.subitems) ? item.subitems : [];

export const foliatePositionKey = (documentId: string): string =>
  `reader:foliate-spike:position:${documentId}`;

export const isAllowedExternalLink = (href: string): boolean => {
  try {
    const url = new URL(href.trim());
    return ['http:', 'https:', 'mailto:'].includes(url.protocol.toLowerCase());
  } catch {
    return false;
  }
};

export const formatFoliateLocation = (relocation: FoliateRelocation): string => {
  const chapter = relocation.tocItem?.label?.trim();
  const current = relocation.location?.current;
  const total = relocation.location?.total;
  const progress =
    typeof current === 'number' && typeof total === 'number'
      ? `${current}/${total}`
      : typeof relocation.fraction === 'number'
        ? `${Math.round(relocation.fraction * 100)}%`
        : '';

  return [chapter, progress].filter(Boolean).join(' · ');
};
