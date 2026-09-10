import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import {
  parsePublicationLocatorV1,
  type PublicationLocatorV1,
} from './publicationLocator';

export const PUBLICATION_BLOCK_PAGE_DEFAULT = 100;
export const PUBLICATION_BLOCK_PAGE_MAX = 200;
export const PUBLICATION_BLOCK_OFFSET_MAX = 50_000;

export type PublicationBlocksInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

export type PublicationBlockV2 = {
  id: string;
  spineIndex: number;
  blockIndex: number;
  href: string;
  kind: string;
  plainText: string;
  language: string | null;
  direction: string | null;
  locator: PublicationLocatorV1;
};

export type PublicationBlocksV2 = {
  schemaVersion: 1;
  publicationId: string;
  documentId: string;
  sourceHash: string;
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  blocks: PublicationBlockV2[];
};

export type PublicationBlockCollectionV2 = {
  schemaVersion: 1;
  publicationId: string;
  documentId: string;
  sourceHash: string;
  blocks: PublicationBlockV2[];
};

const invokeTauri: PublicationBlocksInvoke = (command, args) => tauriInvoke(command, args);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const assertKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void => {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) throw new Error(`Unknown ${label} field: ${unknown}`);
};

const nullableString = (value: unknown, label: string): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null`);
  return value;
};

export const getPublicationBlocksV2 = async (
  documentId: string,
  page: { offset?: number; limit?: number } = {},
  invoke: PublicationBlocksInvoke = invokeTauri
): Promise<PublicationBlocksV2> => {
  const offset = page.offset ?? 0;
  const limit = page.limit ?? PUBLICATION_BLOCK_PAGE_DEFAULT;
  if (!documentId) throw new Error('Publication documentId is required');
  if (!isIndex(offset) || offset > PUBLICATION_BLOCK_OFFSET_MAX) {
    throw new Error('Publication block offset is invalid');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PUBLICATION_BLOCK_PAGE_MAX) {
    throw new Error('Publication block limit is invalid');
  }
  const value = await invoke('publication_get_blocks_v2', {
    request: { documentId, offset, limit },
  });
  if (!isRecord(value)) throw new Error('Publication blocks response must be an object');
  assertKeys(
    value,
    ['schemaVersion', 'publicationId', 'documentId', 'sourceHash', 'offset', 'limit', 'total', 'hasMore', 'blocks'],
    'publication blocks response'
  );
  if (value.schemaVersion !== 1) throw new Error('Unsupported publication blocks schema version');
  if (value.documentId !== documentId) throw new Error('Publication document identity mismatch');
  if (typeof value.publicationId !== 'string' || !value.publicationId) {
    throw new Error('Publication identity is invalid');
  }
  if (typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sourceHash)) {
    throw new Error('Publication source hash is invalid');
  }
  if (value.offset !== offset || value.limit !== limit || !isIndex(value.total)) {
    throw new Error('Publication block page metadata is invalid');
  }
  if (typeof value.hasMore !== 'boolean' || !Array.isArray(value.blocks)) {
    throw new Error('Publication block page is incomplete');
  }
  if (value.blocks.length > limit) throw new Error('Publication block page exceeds its limit');

  const blocks = value.blocks.map((candidate, index): PublicationBlockV2 => {
    if (!isRecord(candidate)) throw new Error(`Publication block ${index} must be an object`);
    assertKeys(
      candidate,
      ['id', 'spineIndex', 'blockIndex', 'href', 'kind', 'plainText', 'language', 'direction', 'locator'],
      'publication block'
    );
    if (
      typeof candidate.id !== 'string' || !candidate.id ||
      !isIndex(candidate.spineIndex) || !isIndex(candidate.blockIndex) ||
      typeof candidate.href !== 'string' || typeof candidate.kind !== 'string' ||
      typeof candidate.plainText !== 'string'
    ) {
      throw new Error(`Publication block ${index} fields are invalid`);
    }
    const locator = parsePublicationLocatorV1(candidate.locator, {
      publicationId: value.publicationId as string,
      sourceHash: value.sourceHash as string,
      href: candidate.href,
    });
    if (locator.text?.highlight !== candidate.plainText) {
      throw new Error(`Publication block ${index} text does not match its locator`);
    }
    return {
      id: candidate.id,
      spineIndex: candidate.spineIndex,
      blockIndex: candidate.blockIndex,
      href: candidate.href,
      kind: candidate.kind,
      plainText: candidate.plainText,
      language: nullableString(candidate.language, `Publication block ${index} language`),
      direction: nullableString(candidate.direction, `Publication block ${index} direction`),
      locator,
    };
  });
  for (let index = 1; index < blocks.length; index += 1) {
    const previous = blocks[index - 1];
    const current = blocks[index];
    if (
      current.spineIndex < previous.spineIndex ||
      (current.spineIndex === previous.spineIndex && current.blockIndex < previous.blockIndex) ||
      (current.spineIndex === previous.spineIndex &&
        current.blockIndex === previous.blockIndex && current.id <= previous.id)
    ) {
      throw new Error('Publication blocks are not in canonical order');
    }
  }
  const expectedHasMore = offset + blocks.length < (value.total as number);
  if (value.hasMore !== expectedHasMore) throw new Error('Publication block continuation is invalid');

  return {
    schemaVersion: 1,
    publicationId: value.publicationId,
    documentId,
    sourceHash: value.sourceHash,
    offset,
    limit,
    total: value.total,
    hasMore: value.hasMore,
    blocks,
  };
};

/**
 * Reads the complete bounded semantic-block collection for one publication.
 * The backend deliberately exposes pages; keeping the pagination contract here
 * gives all reader consumers one validated content source.
 */
export const loadPublicationBlocksV2 = async (
  documentId: string,
  options: { limit?: number } = {},
  invoke: PublicationBlocksInvoke = invokeTauri
): Promise<PublicationBlockCollectionV2> => {
  const limit = options.limit ?? PUBLICATION_BLOCK_PAGE_DEFAULT;
  const blocks: PublicationBlockV2[] = [];
  let offset = 0;
  let total: number | null = null;
  let publicationId: string | null = null;
  let sourceHash: string | null = null;

  while (true) {
    const page = await getPublicationBlocksV2(documentId, { offset, limit }, invoke);
    if (total === null) {
      total = page.total;
      publicationId = page.publicationId;
      sourceHash = page.sourceHash;
    } else if (
      page.total !== total ||
      page.publicationId !== publicationId ||
      page.sourceHash !== sourceHash
    ) {
      throw new Error('Publication block collection identity changed while loading');
    }

    if (page.offset !== offset) throw new Error('Publication block page offset drifted');
    if (page.hasMore && page.blocks.length === 0) {
      throw new Error('Publication block collection did not make progress');
    }

    const previous = blocks[blocks.length - 1];
    const first = page.blocks[0];
    if (
      previous && first &&
      (first.spineIndex < previous.spineIndex ||
        (first.spineIndex === previous.spineIndex && first.blockIndex < previous.blockIndex) ||
        (first.spineIndex === previous.spineIndex &&
          first.blockIndex === previous.blockIndex && first.id <= previous.id))
    ) {
      throw new Error('Publication block collection is not in canonical order');
    }

    blocks.push(...page.blocks);
    if (blocks.length > page.total || blocks.length > PUBLICATION_BLOCK_OFFSET_MAX) {
      throw new Error('Publication block collection exceeds its declared total');
    }
    if (!page.hasMore) break;
    offset = blocks.length;
    if (offset > PUBLICATION_BLOCK_OFFSET_MAX) {
      throw new Error('Publication block collection exceeds its offset limit');
    }
  }

  if (total === null || publicationId === null || sourceHash === null || blocks.length !== total) {
    throw new Error('Publication block collection is incomplete');
  }

  return { schemaVersion: 1, publicationId, documentId, sourceHash, blocks };
};
