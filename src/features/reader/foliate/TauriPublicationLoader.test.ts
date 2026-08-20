import { describe, expect, it, vi } from 'vitest';
import { TauriPublicationLoader, type PublicationInvoke } from './TauriPublicationLoader';

const openResponse = {
  schemaVersion: 1,
  sessionId: 'session-1',
  documentId: 'document-1',
  resourceSizes: {
    'META-INF/container.xml': 240,
    'EPUB/chapter.xhtml': 1024,
    'EPUB/image.svg': 128,
  },
};

describe('TauriPublicationLoader', () => {
  it('opens by document identity and provides synchronous allowlisted size lookup', async () => {
    const invoke = vi.fn<PublicationInvoke>().mockResolvedValue(openResponse);
    const loader = await TauriPublicationLoader.open('document-1', invoke);

    expect(invoke).toHaveBeenCalledWith('publication_open_v2', {
      request: { documentId: 'document-1' },
    });
    expect(loader.sessionId).toBe('session-1');
    expect(loader.documentId).toBe('document-1');
    expect(loader.getSize('EPUB/chapter.xhtml')).toBe(1024);
    expect(loader.getSize('EPUB/missing.xhtml')).toBe(0);
  });

  it('keeps foliate loader methods bound when the EPUB constructor destructures them', async () => {
    const invoke = vi.fn<PublicationInvoke>(async (command) => {
      if (command === 'publication_open_v2') return openResponse;
      if (command === 'publication_load_text_v2') {
        return { schemaVersion: 1, text: '<container />' };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const loader = await TauriPublicationLoader.open('document-1', invoke);
    const { loadText, getSize } = loader;

    await expect(loadText('META-INF/container.xml')).resolves.toBe('<container />');
    expect(getSize('EPUB/chapter.xhtml')).toBe(1024);
  });

  it('maps direct foliate resource paths to text and blob session commands', async () => {
    const invoke = vi.fn<PublicationInvoke>(async (command) => {
      if (command === 'publication_open_v2') return openResponse;
      if (command === 'publication_load_text_v2') return { schemaVersion: 1, text: '<html />' };
      if (command === 'publication_load_blob_v2') return { schemaVersion: 1, bytes: [60, 115, 118, 103, 62] };
      throw new Error(`Unexpected command: ${command}`);
    });
    const loader = await TauriPublicationLoader.open('document-1', invoke);

    await expect(loader.loadText('EPUB/chapter.xhtml#section')).resolves.toBe('<html />');
    const blob = await loader.loadBlob('EPUB/image.svg', 'image/svg+xml');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('image/svg+xml');
    expect(await blob?.text()).toBe('<svg>');
    expect(invoke).toHaveBeenCalledWith('publication_load_text_v2', {
      request: {
        sessionId: 'session-1',
        baseHref: '',
        href: 'EPUB/chapter.xhtml',
      },
    });
  });

  it('returns null for optional missing EPUB resources but preserves other command errors', async () => {
    const missingInvoke = vi.fn<PublicationInvoke>(async (command) => {
      if (command === 'publication_open_v2') return openResponse;
      throw { code: 'publication.resource_not_found', message: 'missing', recoverable: true };
    });
    const missingLoader = await TauriPublicationLoader.open('document-1', missingInvoke);
    await expect(missingLoader.loadText('META-INF/encryption.xml')).resolves.toBeNull();
    await expect(missingLoader.loadBlob('META-INF/cover.png')).resolves.toBeNull();

    const blocked = { code: 'publication.external_resource_blocked', message: 'blocked' };
    const blockedInvoke = vi.fn<PublicationInvoke>(async (command) => {
      if (command === 'publication_open_v2') return openResponse;
      throw blocked;
    });
    const blockedLoader = await TauriPublicationLoader.open('document-1', blockedInvoke);
    await expect(blockedLoader.loadText('https://example.com/tracker')).rejects.toBe(blocked);
  });

  it('reports byte volume, latency, missing resources, and failures at the IPC boundary', async () => {
    const invoke = vi.fn<PublicationInvoke>(async (command, args) => {
      if (command === 'publication_open_v2') return openResponse;
      const href = (args?.request as { href?: string } | undefined)?.href;
      if (href === 'EPUB/missing.xhtml') {
        throw { code: 'publication.resource_not_found' };
      }
      if (href === 'EPUB/blocked.bin') {
        throw { code: 'publication.resource_unsafe' };
      }
      if (command === 'publication_load_text_v2') {
        return { schemaVersion: 1, text: '<é>' };
      }
      if (command === 'publication_load_blob_v2') {
        return { schemaVersion: 1, bytes: [1, 2, 3] };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const loader = await TauriPublicationLoader.open('document-1', invoke);

    await loader.loadText('EPUB/chapter.xhtml');
    await loader.loadText('EPUB/missing.xhtml');
    await loader.loadBlob('EPUB/image.svg');
    await loader.loadBlob('EPUB/missing.xhtml');
    await expect(loader.loadBlob('EPUB/blocked.bin')).rejects.toMatchObject({
      code: 'publication.resource_unsafe',
    });

    const metrics = loader.getMetrics();
    expect(metrics.text).toMatchObject({ requests: 2, bytes: 4, missing: 1, failures: 0 });
    expect(metrics.blob).toMatchObject({
      requests: 3,
      bytes: 3,
      missing: 1,
      failures: 1,
      maxBytes: 3,
    });
    expect(metrics.text.totalMs).toBeGreaterThanOrEqual(0);
    expect(metrics.blob.totalMs).toBeGreaterThanOrEqual(0);

    metrics.blob.bytes = 999;
    expect(loader.getMetrics().blob.bytes).toBe(3);
  });

  it('closes once and rejects resource operations after closure begins', async () => {
    const invoke = vi.fn<PublicationInvoke>().mockResolvedValue(openResponse);
    const loader = await TauriPublicationLoader.open('document-1', invoke);

    await Promise.all([loader.close(), loader.close()]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('publication_close_v2', {
      request: { sessionId: 'session-1' },
    });
    await expect(loader.loadText('EPUB/chapter.xhtml')).rejects.toThrow('closed');
  });

  it('rejects incompatible or mismatched open responses', async () => {
    const wrongVersion = vi.fn<PublicationInvoke>().mockResolvedValue({
      ...openResponse,
      schemaVersion: 2,
    });
    await expect(TauriPublicationLoader.open('document-1', wrongVersion)).rejects.toThrow(
      'schema version'
    );
    expect(wrongVersion).toHaveBeenCalledWith('publication_close_v2', {
      request: { sessionId: 'session-1' },
    });

    const wrongDocument = vi.fn<PublicationInvoke>().mockResolvedValue({
      ...openResponse,
      documentId: 'another-document',
    });
    await expect(TauriPublicationLoader.open('document-1', wrongDocument)).rejects.toThrow(
      'document identity'
    );
    expect(wrongDocument).toHaveBeenCalledWith('publication_close_v2', {
      request: { sessionId: 'session-1' },
    });
  });
});
