export const LOCATOR_SCHEMA_VERSION = 1 as const;
export const LOCATOR_QUOTE_CONTEXT_CHARS = 48;

export type PublicationLocatorV1 = {
  schemaVersion: 1;
  publicationId: string;
  sourceHash: string;
  href: string;
  type?: string;
  title?: string;
  locations: {
    cfi?: string;
    progression?: number;
    totalProgression?: number;
    position?: number;
    cssSelector?: string;
  };
  text?: {
    before?: string;
    highlight?: string;
    after?: string;
  };
};

export type LocatorIdentity = {
  publicationId: string;
  sourceHash: string;
  href: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertKnownKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void => {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Unknown ${label} field: ${unknown}`);
};

const optionalString = (
  value: Record<string, unknown>,
  key: string
): string | undefined => {
  const candidate = value[key];
  if (candidate === undefined) return undefined;
  if (typeof candidate !== 'string') throw new Error(`Locator ${key} must be a string`);
  return candidate;
};

const progression = (value: unknown, key: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Locator ${key} must be within [0, 1]`);
  }
  return value;
};

const validHref = (href: string): boolean => {
  const lower = href.toLowerCase();
  if (!href || href.startsWith('/') || href.includes('\\') || /[\u0000-\u001f\u007f]/u.test(href)) {
    return false;
  }
  if (lower.includes('%2f') || lower.includes('%5c')) return false;
  if (href.split(/[\/#]/u).some((segment) => segment === '.' || segment === '..')) return false;
  try {
    new URL(href);
    return false;
  } catch {
    return true;
  }
};

export const parsePublicationLocatorV1 = (
  value: unknown,
  expected?: LocatorIdentity
): PublicationLocatorV1 => {
  if (!isRecord(value)) throw new Error('Locator must be an object');
  assertKnownKeys(
    value,
    ['schemaVersion', 'publicationId', 'sourceHash', 'href', 'type', 'title', 'locations', 'text'],
    'locator'
  );
  if (value.schemaVersion !== LOCATOR_SCHEMA_VERSION) {
    throw new Error(`Unsupported locator schema version: ${String(value.schemaVersion)}`);
  }
  if (typeof value.publicationId !== 'string' || !value.publicationId) {
    throw new Error('Locator publicationId is invalid');
  }
  if (typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sourceHash)) {
    throw new Error('Locator sourceHash is invalid');
  }
  if (typeof value.href !== 'string' || !validHref(value.href)) {
    throw new Error('Locator href is invalid');
  }
  if (expected?.publicationId !== undefined && value.publicationId !== expected.publicationId) {
    throw new Error('Locator publication identity does not match');
  }
  if (expected?.sourceHash !== undefined && value.sourceHash !== expected.sourceHash) {
    throw new Error('Locator source hash does not match');
  }
  if (expected?.href !== undefined && value.href !== expected.href) {
    throw new Error('Locator href does not match');
  }
  if (!isRecord(value.locations)) throw new Error('Locator locations must be an object');
  assertKnownKeys(
    value.locations,
    ['cfi', 'progression', 'totalProgression', 'position', 'cssSelector'],
    'locations'
  );
  const cfi = optionalString(value.locations, 'cfi');
  const cssSelector = optionalString(value.locations, 'cssSelector');
  const hrefProgression = progression(value.locations.progression, 'progression');
  const totalProgression = progression(value.locations.totalProgression, 'totalProgression');
  const position = value.locations.position;
  if (
    position !== undefined &&
    (typeof position !== 'number' || !Number.isSafeInteger(position) || position <= 0)
  ) {
    throw new Error('Locator position must be a positive safe integer');
  }

  let text: PublicationLocatorV1['text'];
  if (value.text !== undefined) {
    if (!isRecord(value.text)) throw new Error('Locator text must be an object');
    assertKnownKeys(value.text, ['before', 'highlight', 'after'], 'text');
    const before = optionalString(value.text, 'before');
    const highlight = optionalString(value.text, 'highlight');
    const after = optionalString(value.text, 'after');
    if (before !== undefined && Array.from(before).length > LOCATOR_QUOTE_CONTEXT_CHARS) {
      throw new Error('Locator before quote exceeds the context bound');
    }
    if (after !== undefined && Array.from(after).length > LOCATOR_QUOTE_CONTEXT_CHARS) {
      throw new Error('Locator after quote exceeds the context bound');
    }
    if (highlight !== undefined && !highlight.trim()) {
      throw new Error('Locator text highlight is empty');
    }
    text = { before, highlight, after };
  }
  if (
    !cfi?.trim() &&
    !cssSelector?.trim() &&
    hrefProgression === undefined &&
    position === undefined &&
    !text?.highlight?.trim()
  ) {
    throw new Error('Locator has no usable anchor');
  }

  return {
    schemaVersion: LOCATOR_SCHEMA_VERSION,
    publicationId: value.publicationId,
    sourceHash: value.sourceHash,
    href: value.href,
    type: optionalString(value, 'type'),
    title: optionalString(value, 'title'),
    locations: {
      cfi,
      progression: hrefProgression,
      totalProgression,
      position: position as number | undefined,
      cssSelector,
    },
    text,
  };
};
