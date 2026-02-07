import { convertFileSrc } from '@tauri-apps/api/core';

type WorkerLoaded = {
  type: 'loaded';
  key: string;
};

type WorkerProgress = {
  type: 'embedding';
  requestId: string;
  done: number;
  total: number;
};

type WorkerCompleted = {
  type: 'completed';
  requestId: string;
  vectors: number[][];
};

type WorkerError = {
  type: 'error';
  requestId?: string;
  message: string;
};

type WorkerEvent = WorkerLoaded | WorkerProgress | WorkerCompleted | WorkerError;

type EmbedProgress = {
  done: number;
  total: number;
};

type EmbedOptions = {
  onProgress?: (progress: EmbedProgress) => void;
  signal?: AbortSignal;
};

class LocalEmbeddingEngine {
  private worker: Worker;
  private initializedKey: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.worker = new Worker(new URL('../workers/embeddingWorker.ts', import.meta.url), {
      type: 'module',
    });
  }

  async init(model: string, localModelPath?: string): Promise<void> {
    const local = this.resolveLocalModelSpec(localModelPath);
    const key = `${model}|${local?.baseUrl || ''}|${local?.modelName || ''}`;
    if (this.initializedKey === key) return;
    await this.enqueue(async () => {
      await this.waitForLoaded(model, local?.baseUrl, local?.modelName, key);
      this.initializedKey = key;
    });
  }

  async embed(texts: string[], options: EmbedOptions = {}): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.enqueue(async () => this.waitForEmbedding(texts, options));
  }

  cancel(requestId: string) {
    this.worker.postMessage({ type: 'cancel', requestId });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private waitForLoaded(
    model: string,
    localBaseUrl: string | undefined,
    localModelName: string | undefined,
    key: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerEvent>) => {
        const data = event.data;
        if (data.type === 'loaded' && data.key === key) {
          cleanup();
          resolve();
          return;
        }
        if (data.type === 'error' && !data.requestId) {
          cleanup();
          reject(new Error(data.message));
        }
      };
      const cleanup = () => {
        this.worker.removeEventListener('message', onMessage);
      };
      this.worker.addEventListener('message', onMessage);
      this.worker.postMessage({
        type: 'init',
        model,
        localBaseUrl,
        localModelName,
      });
    });
  }

  private resolveLocalModelSpec(
    localModelPath?: string
  ): { baseUrl: string; modelName: string } | undefined {
    const raw = (localModelPath || '').trim();
    if (!raw) return undefined;
    const normalized = raw.replace(/^file:\/\//, '').replace(/\\/g, '/').replace(/\/+$/, '');
    const modelDir = normalized.endsWith('/config.json')
      ? normalized.slice(0, -'/config.json'.length)
      : normalized;
    const parts = modelDir.split('/').filter(Boolean);
    const modelName = parts[parts.length - 1];
    const parentDir = modelDir.slice(0, modelDir.length - modelName.length).replace(/\/+$/, '');
    if (!modelName || !parentDir) return undefined;
    const baseUrl = convertFileSrc(`${parentDir}/`);
    if (!baseUrl) return undefined;
    return {
      baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
      modelName,
    };
  }

  private waitForEmbedding(texts: string[], options: EmbedOptions): Promise<number[][]> {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerEvent>) => {
        const data = event.data;
        if (data.type === 'embedding' && data.requestId === requestId) {
          options.onProgress?.({ done: data.done, total: data.total });
          return;
        }
        if (data.type === 'completed' && data.requestId === requestId) {
          cleanup();
          resolve(data.vectors);
          return;
        }
        if (data.type === 'error' && data.requestId === requestId) {
          cleanup();
          reject(new Error(data.message));
        }
      };
      const onAbort = () => {
        this.cancel(requestId);
        cleanup();
        reject(new DOMException('Embedding task aborted', 'AbortError'));
      };
      const cleanup = () => {
        this.worker.removeEventListener('message', onMessage);
        options.signal?.removeEventListener('abort', onAbort);
      };
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      options.signal?.addEventListener('abort', onAbort);
      this.worker.addEventListener('message', onMessage);
      this.worker.postMessage({
        type: 'embed',
        requestId,
        texts,
      });
    });
  }
}

export const localEmbeddingEngine = new LocalEmbeddingEngine();
