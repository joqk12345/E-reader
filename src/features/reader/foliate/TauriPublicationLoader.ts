import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type PublicationInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

const invokeTauri: PublicationInvoke = (command, args) => tauriInvoke(command, args);

type OpenResponse = {
  schemaVersion: number;
  sessionId: string;
  documentId: string;
  resourceSizes: Record<string, number>;
};

type TextResponse = { schemaVersion: number; text: string };
type BlobResponse = { schemaVersion: number; bytes: number[] | Uint8Array };

export type PublicationLoadMetrics = {
  text: { requests: number; bytes: number; missing: number; failures: number; totalMs: number };
  blob: { requests: number; bytes: number; missing: number; failures: number; totalMs: number; maxBytes: number };
};

const assertSchemaVersion = (response: { schemaVersion?: unknown }): void => {
  if (response.schemaVersion !== 1) {
    throw new Error(`Unsupported publication schema version: ${String(response.schemaVersion)}`);
  }
};

const errorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const nested = (error as { error?: { code?: unknown } }).error?.code;
  return typeof nested === 'string' ? nested : undefined;
};

const directResourcePath = (href: string): string => {
  const path = href.split(/[?#]/, 1)[0];
  if (!path) throw new Error(`Publication resource path is empty: ${href}`);
  return path;
};

class PublicationOpenCleanupError extends Error {
  constructor(readonly errors: readonly unknown[]) {
    super('Publication response validation and session cleanup both failed');
    this.name = 'PublicationOpenCleanupError';
  }
}

export class TauriPublicationLoader {
  private closePromise: Promise<void> | null = null;
  private readonly metrics: PublicationLoadMetrics = {
    text: { requests: 0, bytes: 0, missing: 0, failures: 0, totalMs: 0 },
    blob: { requests: 0, bytes: 0, missing: 0, failures: 0, totalMs: 0, maxBytes: 0 },
  };

  private constructor(
    readonly sessionId: string,
    readonly documentId: string,
    private readonly invoke: PublicationInvoke,
    private readonly resourceSizes: ReadonlyMap<string, number>
  ) {}

  static async open(
    documentId: string,
    invoke: PublicationInvoke = invokeTauri
  ): Promise<TauriPublicationLoader> {
    const response = await invoke('publication_open_v2', {
      request: { documentId },
    }) as OpenResponse;
    try {
      assertSchemaVersion(response);
      if (response.documentId !== documentId) {
        throw new Error(
          `Publication document identity mismatch: expected ${documentId}, received ${response.documentId}`
        );
      }
      if (!response.sessionId || !response.resourceSizes || typeof response.resourceSizes !== 'object') {
        throw new Error('Publication open response is incomplete');
      }
    } catch (validationError) {
      if (response && typeof response.sessionId === 'string' && response.sessionId) {
        try {
          await invoke('publication_close_v2', {
            request: { sessionId: response.sessionId },
          });
        } catch (closeError) {
          throw new PublicationOpenCleanupError([validationError, closeError]);
        }
      }
      throw validationError;
    }

    const sizes = new Map<string, number>();
    for (const [href, size] of Object.entries(response.resourceSizes)) {
      if (Number.isFinite(size) && size >= 0) sizes.set(href, size);
    }
    return new TauriPublicationLoader(response.sessionId, response.documentId, invoke, sizes);
  }

  readonly loadText = async (href: string): Promise<string | null> => {
    this.assertOpen();
    const path = directResourcePath(href);
    const startedAt = performance.now();
    this.metrics.text.requests += 1;
    try {
      const response = await this.invoke('publication_load_text_v2', {
        request: { sessionId: this.sessionId, baseHref: '', href: path },
      }) as TextResponse;
      assertSchemaVersion(response);
      this.metrics.text.bytes += new TextEncoder().encode(response.text).byteLength;
      return response.text;
    } catch (error) {
      if (errorCode(error) === 'publication.resource_not_found') {
        this.metrics.text.missing += 1;
        return null;
      }
      this.metrics.text.failures += 1;
      throw error;
    } finally {
      this.metrics.text.totalMs += performance.now() - startedAt;
    }
  }

  readonly loadBlob = async (href: string, mediaType?: string): Promise<Blob | null> => {
    this.assertOpen();
    const path = directResourcePath(href);
    const startedAt = performance.now();
    this.metrics.blob.requests += 1;
    try {
      const response = await this.invoke('publication_load_blob_v2', {
        request: { sessionId: this.sessionId, baseHref: '', href: path },
      }) as BlobResponse;
      assertSchemaVersion(response);
      const bytes = Uint8Array.from(response.bytes);
      this.metrics.blob.bytes += bytes.byteLength;
      this.metrics.blob.maxBytes = Math.max(this.metrics.blob.maxBytes, bytes.byteLength);
      return new Blob([bytes.buffer], mediaType ? { type: mediaType } : undefined);
    } catch (error) {
      if (errorCode(error) === 'publication.resource_not_found') {
        this.metrics.blob.missing += 1;
        return null;
      }
      this.metrics.blob.failures += 1;
      throw error;
    } finally {
      this.metrics.blob.totalMs += performance.now() - startedAt;
    }
  }

  readonly getSize = (href: string): number => {
    this.assertOpen();
    return this.resourceSizes.get(directResourcePath(href)) ?? 0;
  };

  getMetrics(): PublicationLoadMetrics {
    return {
      text: { ...this.metrics.text },
      blob: { ...this.metrics.blob },
    };
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.invoke('publication_close_v2', {
      request: { sessionId: this.sessionId },
    }).then(() => undefined);
    return this.closePromise;
  }

  private assertOpen(): void {
    if (this.closePromise) throw new Error('Publication loader is closed');
  }
}

export type { OpenResponse };
