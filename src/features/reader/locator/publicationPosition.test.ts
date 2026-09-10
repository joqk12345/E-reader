import { describe, expect, it, vi } from 'vitest';
import {
  getPublicationPositionV2,
  savePublicationPositionV2,
  type PublicationPositionInvoke,
} from './publicationPosition';
import type { PublicationLocatorV1 } from './publicationLocator';

const locator: PublicationLocatorV1 = {
  schemaVersion: 1,
  publicationId: 'publication-1',
  sourceHash: 'a'.repeat(64),
  href: 'EPUB/chapter.xhtml',
  locations: { cfi: 'epubcfi(/6/4!/4/2)' },
  text: { highlight: 'Current chapter' },
};

const position = {
  schemaVersion: 1,
  publicationId: 'publication-1',
  documentId: 'document-1',
  sourceHash: 'a'.repeat(64),
  locator,
  progression: 0.25,
  updatedAt: 100,
};

describe('publication position V2 adapter', () => {
  it('loads an absent position without inventing a localStorage value', async () => {
    const invoke = vi.fn<PublicationPositionInvoke>().mockResolvedValue(null);
    await expect(getPublicationPositionV2('document-1', invoke)).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith('publication_get_position_v2', {
      request: { documentId: 'document-1' },
    });
  });

  it('validates and saves a locator with monotonic timestamp metadata', async () => {
    const invoke = vi.fn<PublicationPositionInvoke>().mockResolvedValue({ ...position, accepted: true });
    await expect(
      savePublicationPositionV2('document-1', locator, { progression: 0.25, updatedAt: 100 }, invoke)
    ).resolves.toMatchObject({ accepted: true, locator });
    expect(invoke).toHaveBeenCalledWith('publication_save_position_v2', {
      request: {
        documentId: 'document-1',
        locator,
        progression: 0.25,
        updatedAt: 100,
      },
    });
  });

  it('rejects invalid response identity, fields, and stale metadata', async () => {
    const wrongDocument = vi.fn<PublicationPositionInvoke>().mockResolvedValue({
      ...position,
      documentId: 'other-document',
    });
    await expect(getPublicationPositionV2('document-1', wrongDocument)).rejects.toThrow('identity');

    const unknownField = vi.fn<PublicationPositionInvoke>().mockResolvedValue({ ...position, extra: true });
    await expect(getPublicationPositionV2('document-1', unknownField)).rejects.toThrow('Unknown');

    await expect(
      savePublicationPositionV2('document-1', locator, { updatedAt: 0 }, vi.fn())
    ).rejects.toThrow('updatedAt');
  });

  it('accepts a server response that declines a stale write while returning the current position', async () => {
    const invoke = vi.fn<PublicationPositionInvoke>().mockResolvedValue({
      ...position,
      progression: 0.9,
      updatedAt: 200,
      accepted: false,
    });
    await expect(
      savePublicationPositionV2('document-1', locator, { progression: 0.1, updatedAt: 100 }, invoke)
    ).resolves.toMatchObject({ accepted: false, progression: 0.9, updatedAt: 200 });
  });
});
