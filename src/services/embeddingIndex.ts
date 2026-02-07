import { invoke } from '@tauri-apps/api/core';
import { localEmbeddingEngine } from './localEmbedding';

export type EmbeddingProvider = 'local_transformers' | 'lmstudio' | 'openai_compatible' | 'ollama';

export type EmbeddingProfile = {
  provider: EmbeddingProvider;
  model: string;
  dimension: number;
};

type Paragraph = {
  id: string;
  text: string;
};

type UpsertRequest = {
  profile: {
    provider: string;
    model: string;
    dimension: number;
  };
  items: Array<{
    paragraph_id: string;
    vector: number[];
  }>;
};

export type EmbeddingStatus = {
  indexed: number;
  total: number;
  stale: number;
  profile: {
    provider: string;
    model: string;
    dimension: number;
  };
};

export type IndexProgress = {
  phase: 'loading_model' | 'embedding' | 'storing';
  done: number;
  total: number;
};

const DEFAULT_BATCH_SIZE = 16;

export const indexDocumentWithLocalEmbedding = async (
  docId: string,
  profile: EmbeddingProfile,
  options: {
    onProgress?: (progress: IndexProgress) => void;
    signal?: AbortSignal;
    localModelPath?: string;
  } = {}
) => {
  options.onProgress?.({ phase: 'loading_model', done: 0, total: 1 });
  await localEmbeddingEngine.init(profile.model, options.localModelPath);

  const paragraphs = await invoke<Paragraph[]>('get_document_paragraphs', { docId });
  if (paragraphs.length === 0) {
    return { upserted: 0 };
  }

  let processed = 0;
  for (let i = 0; i < paragraphs.length; i += DEFAULT_BATCH_SIZE) {
    if (options.signal?.aborted) {
      throw new DOMException('Indexing aborted', 'AbortError');
    }
    const chunk = paragraphs.slice(i, i + DEFAULT_BATCH_SIZE);
    const vectors = await localEmbeddingEngine.embed(
      chunk.map((item) => item.text),
      {
        signal: options.signal,
        onProgress: (progress) => {
          options.onProgress?.({
            phase: 'embedding',
            done: processed + progress.done,
            total: paragraphs.length,
          });
        },
      }
    );

    const payload: UpsertRequest = {
      profile: {
        provider: profile.provider,
        model: profile.model,
        dimension: profile.dimension,
      },
      items: chunk.map((item, idx) => ({
        paragraph_id: item.id,
        vector: vectors[idx],
      })),
    };
    options.onProgress?.({
      phase: 'storing',
      done: processed,
      total: paragraphs.length,
    });
    await invoke('upsert_embeddings_batch', { request: payload });
    processed += chunk.length;
  }

  return { upserted: processed };
};

export const getEmbeddingStatus = async (docId?: string) => {
  return invoke<EmbeddingStatus>('get_embedding_profile_status', {
    docId: docId || null,
  });
};

export const embedQuery = async (query: string, profile: EmbeddingProfile, localModelPath?: string) => {
  await localEmbeddingEngine.init(profile.model, localModelPath);
  const vectors = await localEmbeddingEngine.embed([query]);
  return vectors[0] ?? [];
};
