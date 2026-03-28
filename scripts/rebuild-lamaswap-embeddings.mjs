#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import crypto from 'crypto';

const endpoint = process.env.READER_EMBEDDING_ENDPOINT || 'http://127.0.0.1:8080/v1';
const model = process.env.READER_EMBEDDING_MODEL || 'snowflake-arctic-embed-l-v2.0';
const dimension = Number(process.env.READER_EMBEDDING_DIMENSION || '1024');
const batchSize = Number(process.env.READER_EMBEDDING_BATCH_SIZE || '32');
const requestTimeoutMs = Number(process.env.READER_EMBEDDING_TIMEOUT_MS || '120000');
const pauseMs = Number(process.env.READER_EMBEDDING_PAUSE_MS || '0');
const startOffset = Number(process.env.READER_EMBEDDING_START_OFFSET || '0');

const configPath = path.join(os.homedir(), 'Library', 'Application Support', 'reader', 'config.json');
const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'com.mac.reader', 'reader.db');

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;

const runSql = (sql) =>
  execFileSync('sqlite3', [dbPath], {
    encoding: 'utf8',
    input: sql,
    maxBuffer: 1024 * 1024 * 256,
  });

const runScalar = (sql) => runSql(`${sql.trim()};`).trim();

const vectorToBlobHex = (vector) => {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  for (let i = 0; i < vector.length; i += 1) {
    buffer.writeFloatLE(vector[i], i * 4);
  }
  return buffer.toString('hex');
};

const readParagraphBatch = (offset) => {
  const sql = `
    SELECT id || '|' || hex(CAST(text AS BLOB))
    FROM paragraphs
    ORDER BY id
    LIMIT ${batchSize}
    OFFSET ${offset};
  `;
  const lines = runSql(sql)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const separator = line.indexOf('|');
    const id = line.slice(0, separator);
    const textHex = line.slice(separator + 1);
    return {
      id,
      text: Buffer.from(textHex, 'hex').toString('utf8'),
    };
  });
};

const upsertEmbeddingBatch = (rows, vectors) => {
  const now = Math.floor(Date.now() / 1000);
  const statements = ['BEGIN IMMEDIATE;'];
  for (let i = 0; i < rows.length; i += 1) {
    const blobHex = vectorToBlobHex(vectors[i]);
    const embeddingId = crypto.randomUUID();
    statements.push(
      `INSERT INTO embeddings (id, paragraph_id, vector, dim, provider, model, created_at, updated_at)
       VALUES (${sqlString(embeddingId)}, ${sqlString(rows[i].id)}, X'${blobHex}', ${dimension}, 'openai_compatible', ${sqlString(model)}, ${now}, ${now})
       ON CONFLICT(paragraph_id) DO UPDATE SET
         vector = excluded.vector,
         dim = excluded.dim,
         provider = excluded.provider,
         model = excluded.model,
         updated_at = excluded.updated_at;`
    );
  }
  statements.push('COMMIT;');
  runSql(statements.join('\n'));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
};

const isBatchTooLargeError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('too large to process');
};

const trimRowForRetry = (row) => {
  const nextLength = Math.max(256, Math.floor(row.text.length * 0.75));
  if (nextLength >= row.text.length) {
    return row;
  }
  console.warn(`Truncating oversized paragraph ${row.id} to ${nextLength} chars for embedding`);
  return {
    ...row,
    text: row.text.slice(0, nextLength),
  };
};

const fetchVectors = async (rows) => {
  try {
    const payload = await fetchJson(`${endpoint}/embeddings`, {
      method: 'POST',
      body: JSON.stringify({
        model,
        input: rows.map((row) => row.text),
      }),
    });
    const vectors = (payload.data || []).map((item) => item.embedding);
    if (vectors.length !== rows.length) {
      throw new Error(`Embedding batch size mismatch: expected ${rows.length}, got ${vectors.length}`);
    }
    for (const vector of vectors) {
      if (!Array.isArray(vector) || vector.length !== dimension) {
        throw new Error(`Invalid vector length: expected ${dimension}, got ${vector?.length ?? 'unknown'}`);
      }
    }
    return vectors;
  } catch (error) {
    if (rows.length > 1 && isBatchTooLargeError(error)) {
      const midpoint = Math.ceil(rows.length / 2);
      const left = await fetchVectors(rows.slice(0, midpoint));
      const right = await fetchVectors(rows.slice(midpoint));
      return [...left, ...right];
    }
    if (rows.length === 1 && isBatchTooLargeError(error) && rows[0].text.length > 256) {
      const trimmed = trimRowForRetry(rows[0]);
      if (trimmed.text !== rows[0].text) {
        return fetchVectors([trimmed]);
      }
    }
    throw error;
  }
};

const updateConfig = () => {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const now = Date.now();

  config.embedding_provider = 'openai_compatible';
  config.embedding_model = model;
  config.embedding_dimension = dimension;
  config.lm_studio_url = endpoint;

  config.ai_profiles ||= { providers: [], models: [], agents: [] };
  config.ai_profiles.providers ||= [];
  config.ai_profiles.models ||= [];
  config.ai_profiles.agents ||= [];

  let provider = config.ai_profiles.providers.find(
    (item) => item.provider_type === 'open_ai_compatible' && item.base_url === endpoint
  );
  if (!provider) {
    provider = {
      id: crypto.randomUUID(),
      display_name: 'lama-swap',
      provider_type: 'open_ai_compatible',
      base_url: endpoint,
      api_key: null,
      enabled: true,
      test_model: model,
      created_at: now,
      updated_at: now,
    };
    config.ai_profiles.providers.push(provider);
  } else {
    provider.display_name = provider.display_name || 'lama-swap';
    provider.base_url = endpoint;
    provider.api_key = null;
    provider.enabled = true;
    provider.test_model = model;
    provider.updated_at = now;
  }

  let embeddingModel = config.ai_profiles.models.find(
    (item) =>
      item.capability === 'embedding' &&
      item.provider_profile_id === provider.id &&
      item.model_name === model
  );
  if (!embeddingModel) {
    embeddingModel = {
      id: crypto.randomUUID(),
      provider_profile_id: provider.id,
      profile_name: `lama-swap ${model}`,
      model_name: model,
      capability: 'embedding',
      enabled: true,
      temperature: null,
      max_tokens: null,
      top_p: null,
      system_prompt: null,
      enable_thinking: null,
      embedding_dimension: dimension,
      created_at: now,
      updated_at: now,
    };
    config.ai_profiles.models.push(embeddingModel);
  } else {
    embeddingModel.enabled = true;
    embeddingModel.embedding_dimension = dimension;
    embeddingModel.updated_at = now;
  }

  let embeddingAgent = config.ai_profiles.agents.find((item) => item.slot === 'embedding');
  if (!embeddingAgent) {
    embeddingAgent = {
      slot: 'embedding',
      primary_model_id: embeddingModel.id,
      fallback_model_id: null,
      enabled: true,
      temperature: null,
      max_tokens: null,
      system_prompt: null,
      target_language: null,
      detail_level: null,
      warn_on_auto_summary: null,
      translation_parallelism: null,
    };
    config.ai_profiles.agents.push(embeddingAgent);
  } else {
    embeddingAgent.primary_model_id = embeddingModel.id;
    embeddingAgent.fallback_model_id = null;
    embeddingAgent.enabled = true;
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
};

const main = async () => {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const modelsPayload = await fetchJson(`${endpoint}/models`, { method: 'GET' });
  const availableModels = new Set((modelsPayload.data || []).map((item) => item.id));
  if (!availableModels.has(model)) {
    throw new Error(`Model ${model} is not available at ${endpoint}`);
  }

  const probe = await fetchJson(`${endpoint}/embeddings`, {
    method: 'POST',
    body: JSON.stringify({
      model,
      input: 'hello world',
    }),
  });
  const probeDim = probe?.data?.[0]?.embedding?.length;
  if (probeDim !== dimension) {
    throw new Error(`Dimension mismatch: expected ${dimension}, got ${probeDim ?? 'unknown'}`);
  }

  updateConfig();

  const total = Number(runScalar('SELECT COUNT(*) FROM paragraphs'));
  if (!Number.isFinite(total) || total <= 0) {
    console.log('No paragraphs found, nothing to re-embed.');
    return;
  }

  console.log(`Rebuilding embeddings with ${model} (${dimension} dims) from ${endpoint}`);
  console.log(`Config: ${configPath}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Paragraphs: ${total}`);

  for (let offset = startOffset; offset < total; offset += batchSize) {
    const rows = readParagraphBatch(offset);
    if (rows.length === 0) {
      break;
    }
    const vectors = await fetchVectors(rows);
    upsertEmbeddingBatch(rows, vectors);
    const done = Math.min(offset + rows.length, total);
    console.log(`Processed ${done}/${total}`);

    if (pauseMs > 0 && done < total) {
      await sleep(pauseMs);
    }
  }

  const summary = runSql(`
    SELECT provider || '|' || model || '|' || dim || '|' || COUNT(*)
    FROM embeddings
    GROUP BY provider, model, dim
    ORDER BY COUNT(*) DESC;
  `).trim();

  console.log('Embedding summary:');
  console.log(summary);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
