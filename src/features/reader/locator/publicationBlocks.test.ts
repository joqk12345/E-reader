import { describe, expect, it, vi } from 'vitest';
import {
  getPublicationBlocksV2,
  loadPublicationBlocksV2,
  type PublicationBlocksInvoke,
} from './publicationBlocks';

const locator = (text: string, selector: string) => ({
  schemaVersion: 1,
  publicationId: 'publication-1',
  sourceHash: 'a'.repeat(64),
  href: 'EPUB/chapter.xhtml',
  type: 'application/xhtml+xml',
  locations: { cssSelector: selector },
  text: { highlight: text },
});

const response = () => ({
  schemaVersion: 1,
  publicationId: 'publication-1',
  documentId: 'doc-1',
  sourceHash: 'a'.repeat(64),
  offset: 0,
  limit: 2,
  total: 3,
  hasMore: true,
  blocks: [
    {
      id: 'block-1',
      spineIndex: 0,
      blockIndex: 0,
      href: 'EPUB/chapter.xhtml',
      kind: 'heading',
      plainText: 'Heading',
      language: 'en',
      direction: 'ltr',
      locator: locator('Heading', '#heading'),
    },
    {
      id: 'block-2',
      spineIndex: 0,
      blockIndex: 1,
      href: 'EPUB/chapter.xhtml',
      kind: 'paragraph',
      plainText: 'Paragraph',
      language: null,
      direction: null,
      locator: locator('Paragraph', 'body > p:nth-of-type(1)'),
    },
  ],
});

describe('getPublicationBlocksV2', () => {
  it('sends only document identity and bounded pagination and validates locators', async () => {
    const invoke = vi.fn<PublicationBlocksInvoke>().mockResolvedValue(response());
    const page = await getPublicationBlocksV2('doc-1', { offset: 0, limit: 2 }, invoke);

    expect(invoke).toHaveBeenCalledWith('publication_get_blocks_v2', {
      request: { documentId: 'doc-1', offset: 0, limit: 2 },
    });
    expect(page.blocks.map((block) => block.plainText)).toEqual(['Heading', 'Paragraph']);
    expect(page.blocks[0].locator.publicationId).toBe(page.publicationId);
    expect(page.hasMore).toBe(true);
  });

  it('rejects invalid pages before invoking Tauri', async () => {
    const invoke = vi.fn<PublicationBlocksInvoke>();
    await expect(getPublicationBlocksV2('doc-1', { limit: 0 }, invoke)).rejects.toThrow('limit');
    await expect(getPublicationBlocksV2('doc-1', { limit: 201 }, invoke)).rejects.toThrow('limit');
    await expect(getPublicationBlocksV2('doc-1', { offset: 50_001 }, invoke)).rejects.toThrow(
      'offset'
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('fails closed on response identity, locator, text, ordering, and continuation drift', async () => {
    const cases: unknown[] = [
      { ...response(), documentId: 'other' },
      {
        ...response(),
        blocks: [{ ...response().blocks[0], locator: { ...locator('Heading', '#heading'), sourceHash: 'b'.repeat(64) } }],
      },
      {
        ...response(),
        blocks: [{ ...response().blocks[0], plainText: 'Changed' }],
      },
      {
        ...response(),
        blocks: [response().blocks[1], response().blocks[0]],
      },
      { ...response(), hasMore: false },
    ];
    for (const invalid of cases) {
      const invoke: PublicationBlocksInvoke = async () => invalid;
      await expect(getPublicationBlocksV2('doc-1', { limit: 2 }, invoke)).rejects.toThrow();
    }
  });

  it('rejects unknown response and block fields', async () => {
    await expect(
      getPublicationBlocksV2('doc-1', { limit: 2 }, async () => ({ ...response(), unknown: true }))
    ).rejects.toThrow('Unknown publication blocks response field');
    await expect(
      getPublicationBlocksV2('doc-1', { limit: 2 }, async () => ({
        ...response(),
        blocks: [{ ...response().blocks[0], unknown: true }],
        total: 1,
        hasMore: false,
      }))
    ).rejects.toThrow('Unknown publication block field');
  });
});

describe('loadPublicationBlocksV2', () => {
  it('loads pages in order and returns one validated collection', async () => {
    const first = response();
    const second = {
      ...first,
      offset: 2,
      limit: 2,
      total: 3,
      hasMore: false,
      blocks: [{
        ...first.blocks[1],
        id: 'block-3',
        blockIndex: 2,
        plainText: 'Last paragraph',
        locator: locator('Last paragraph', 'body > p:nth-of-type(2)'),
      }],
    };
    const invoke = vi.fn<PublicationBlocksInvoke>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    const collection = await loadPublicationBlocksV2('doc-1', { limit: 2 }, invoke);

    expect(invoke).toHaveBeenNthCalledWith(1, 'publication_get_blocks_v2', {
      request: { documentId: 'doc-1', offset: 0, limit: 2 },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'publication_get_blocks_v2', {
      request: { documentId: 'doc-1', offset: 2, limit: 2 },
    });
    expect(collection.blocks.map((block) => block.id)).toEqual(['block-1', 'block-2', 'block-3']);
  });

  it('fails closed when a continued collection changes identity or does not make progress', async () => {
    const first = response();
    await expect(loadPublicationBlocksV2('doc-1', { limit: 2 }, vi.fn<PublicationBlocksInvoke>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({
        ...first,
        offset: 2,
        sourceHash: 'b'.repeat(64),
        blocks: [{
          ...first.blocks[1],
          id: 'block-3',
          blockIndex: 2,
          plainText: 'Last paragraph',
          locator: {
            ...locator('Last paragraph', 'body > p:nth-of-type(2)'),
            sourceHash: 'b'.repeat(64),
          },
        }],
        hasMore: false,
      }))).rejects.toThrow('identity changed');

    await expect(loadPublicationBlocksV2('doc-1', { limit: 2 }, vi.fn<PublicationBlocksInvoke>()
      .mockResolvedValue({ ...first, blocks: [], hasMore: true, total: 3 }))).rejects.toThrow(
      'did not make progress'
    );
  });
});
