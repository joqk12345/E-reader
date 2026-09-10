export type FoliateTocItem = {
  label?: string;
  href?: string;
  subitems?: FoliateTocItem[];
};

export type FoliateRelocation = {
  cfi?: string;
  fraction?: number;
  location?: { current?: number; total?: number };
  tocItem?: { label?: string };
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
