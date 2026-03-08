export type TermGlossaryEntry = {
  docId: string;
  term: string;
  termKey: string;
  preferredRendering: string;
  conceptTags: string[];
  updatedAt: number;
};

export const TERM_GLOSSARY_STORAGE_KEY = 'reader_term_glossary_v1';
export const TERM_GLOSSARY_CHANGED_EVENT = 'reader:glossary-changed';

export const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();
export const normalizeTermKey = (value: string) => normalizeWhitespace(value).toLowerCase();

export const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

export const mergeUniqueStrings = (primary: string[], secondary: string[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  [...primary, ...secondary].forEach((item) => {
    const value = item.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out;
};

export const loadTermGlossary = (): TermGlossaryEntry[] => {
  try {
    const raw = localStorage.getItem(TERM_GLOSSARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TermGlossaryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.docId === 'string' && typeof item.termKey === 'string')
      .map((item) => ({
        docId: item.docId,
        term: item.term || item.termKey,
        termKey: item.termKey,
        preferredRendering: item.preferredRendering || '',
        conceptTags: normalizeStringArray(item.conceptTags),
        updatedAt: item.updatedAt || Date.now(),
      }));
  } catch (err) {
    console.warn('Failed to load term glossary:', err);
    return [];
  }
};

export const saveTermGlossary = (entries: TermGlossaryEntry[]) => {
  localStorage.setItem(TERM_GLOSSARY_STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent(TERM_GLOSSARY_CHANGED_EVENT));
};
