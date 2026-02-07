import { env, pipeline } from '@xenova/transformers';

type InitRequest = {
  type: 'init';
  model: string;
  localBaseUrl?: string;
  localModelName?: string;
};

type EmbedRequest = {
  type: 'embed';
  requestId: string;
  texts: string[];
};

type CancelRequest = {
  type: 'cancel';
  requestId: string;
};

type WorkerRequest = InitRequest | EmbedRequest | CancelRequest;

type LoadedEvent = {
  type: 'loaded';
  key: string;
};

type ProgressEvent = {
  type: 'embedding';
  requestId: string;
  done: number;
  total: number;
};

type ResultEvent = {
  type: 'completed';
  requestId: string;
  vectors: number[][];
};

type ErrorEvent = {
  type: 'error';
  requestId?: string;
  message: string;
};

type WorkerEvent = LoadedEvent | ProgressEvent | ResultEvent | ErrorEvent;

const ctx = self as unknown as Worker;

env.allowRemoteModels = true;
env.allowLocalModels = true;
env.useBrowserCache = true;

let extractor: Awaited<ReturnType<typeof pipeline>> | null = null;
let loadedModelKey = '';
const cancelled = new Set<string>();

const emit = (event: WorkerEvent) => {
  ctx.postMessage(event);
};

const ensureModel = async (
  model: string,
  localBaseUrl?: string,
  localModelName?: string
) => {
  const key = `${model}|${localBaseUrl || ''}|${localModelName || ''}`;
  if (extractor && loadedModelKey === key) {
    return;
  }
  if (localBaseUrl && localBaseUrl.trim() && localModelName && localModelName.trim()) {
    try {
      env.localModelPath = localBaseUrl.endsWith('/') ? localBaseUrl : `${localBaseUrl}/`;
      env.allowRemoteModels = false;
      extractor = await (pipeline as any)('feature-extraction', localModelName, {
        local_files_only: true,
      });
      loadedModelKey = key;
      emit({ type: 'loaded', key });
      return;
    } catch (error) {
      const localError = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Local model is unavailable at configured path. ${localError}. localBaseUrl=${localBaseUrl} localModelName=${localModelName}`
      );
    }
  }
  env.allowRemoteModels = true;
  extractor = await pipeline('feature-extraction', model);
  loadedModelKey = key;
  emit({ type: 'loaded', key });
};

const toVector = (output: unknown): number[] => {
  const tensor = output as { data?: Float32Array | number[] };
  if (!tensor || !tensor.data) {
    throw new Error('Embedding output is missing tensor data');
  }
  const arr = Array.from(tensor.data);
  return arr;
};

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const payload = event.data;
    if (payload.type === 'init') {
      await ensureModel(payload.model, payload.localBaseUrl, payload.localModelName);
      return;
    }

    if (payload.type === 'cancel') {
      cancelled.add(payload.requestId);
      return;
    }

    if (!loadedModelKey) {
      await ensureModel('Xenova/all-MiniLM-L6-v2');
    }
    if (!extractor) {
      throw new Error('Embedding model is not initialized');
    }

    const total = payload.texts.length;
    const vectors: number[][] = [];
    for (let i = 0; i < total; i++) {
      if (cancelled.has(payload.requestId)) {
        cancelled.delete(payload.requestId);
        return;
      }
      const out = await (extractor as any)(payload.texts[i], {
        pooling: 'mean',
        normalize: true,
      });
      const vector = toVector(out);
      vectors.push(vector);
      emit({
        type: 'embedding',
        requestId: payload.requestId,
        done: i + 1,
        total,
      });
    }

    emit({
      type: 'completed',
      requestId: payload.requestId,
      vectors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = event.data;
    emit({
      type: 'error',
      requestId: payload.type === 'embed' ? payload.requestId : undefined,
      message,
    });
  }
};
