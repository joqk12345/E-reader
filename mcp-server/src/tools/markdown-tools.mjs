import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

function sqlQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function sqlNullable(value) {
  if (value === undefined || value === null) return 'NULL';
  const text = String(value).trim();
  if (!text) return 'NULL';
  return sqlQuote(text);
}

function candidateDbPaths() {
  const home = os.homedir();
  return [
    process.env.READER_DB_PATH,
    path.join(home, 'Library', 'Application Support', 'com.mac.reader', 'reader.db'),
    path.join(home, 'Library', 'Application Support', 'com.mac.reader.dev', 'reader.db'),
    path.join(home, '.local', 'share', 'com.mac.reader', 'reader.db'),
  ].filter(Boolean);
}

function resolveDbPath(args) {
  const explicit = args?.db_path ? String(args.db_path).trim() : '';
  if (explicit) {
    const dbPath = path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit);
    if (!fs.existsSync(dbPath)) {
      throw new Error(`reader.db not found at db_path: ${dbPath}`);
    }
    return dbPath;
  }

  for (const p of candidateDbPaths()) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error('reader.db not found. Set READER_DB_PATH or pass db_path in tool arguments.');
}

function runSqlJson(dbPath, sql, options = {}) {
  const maxBuffer =
    Number.isInteger(options?.maxBuffer) && options.maxBuffer > 0
      ? options.maxBuffer
      : 10 * 1024 * 1024;
  const run = (targetDbPath) =>
    execFileSync('sqlite3', ['-json', targetDbPath, sql], {
      encoding: 'utf8',
      maxBuffer,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

  try {
    const out = run(dbPath);
    if (!out) return [];
    return JSON.parse(out);
  } catch (error) {
    const message = String(error?.message || error);
    if (
      !message.includes('unable to open database file') &&
      !message.toLowerCase().includes('database is locked')
    ) {
      throw error;
    }

    const snapshotBase = path.join('/tmp', `reader-mcp-snapshot-${process.pid}`);
    const snapshotDb = `${snapshotBase}.db`;
    const srcWal = `${dbPath}-wal`;
    const srcShm = `${dbPath}-shm`;
    const dstWal = `${snapshotDb}-wal`;
    const dstShm = `${snapshotDb}-shm`;

    fs.copyFileSync(dbPath, snapshotDb);
    if (fs.existsSync(srcWal)) fs.copyFileSync(srcWal, dstWal);
    if (fs.existsSync(srcShm)) fs.copyFileSync(srcShm, dstShm);

    try {
      const out = run(snapshotDb);
      if (!out) return [];
      return JSON.parse(out);
    } finally {
      try {
        fs.unlinkSync(snapshotDb);
      } catch {}
      try {
        fs.unlinkSync(dstWal);
      } catch {}
      try {
        fs.unlinkSync(dstShm);
      } catch {}
    }
  }
}

function runSqlExec(dbPath, sql) {
  execFileSync('sqlite3', [dbPath], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 80 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function resolveDocument(dbPath, root, args) {
  const docId = String(args?.doc_id || '').trim();
  const byPath = String(args?.path || '').trim();
  const byTitle = String(args?.title || '').trim();

  if (docId) {
    const rows = runSqlJson(
      dbPath,
      `SELECT id, title, author, language, file_path, file_type, created_at, updated_at
       FROM documents
       WHERE id = ${sqlQuote(docId)}
       LIMIT 1`
    );
    if (rows.length > 0) return rows[0];
    throw new Error(`document not found: ${docId}`);
  }

  if (byPath) {
    const absPath = path.isAbsolute(byPath) ? byPath : path.resolve(root, byPath);
    const exact = runSqlJson(
      dbPath,
      `SELECT id, title, author, language, file_path, file_type, created_at, updated_at
       FROM documents
       WHERE file_path = ${sqlQuote(absPath)}
       LIMIT 1`
    );
    if (exact.length > 0) return exact[0];

    const suffix = byPath.replace(/\\/g, '/');
    const fuzzy = runSqlJson(
      dbPath,
      `SELECT id, title, author, language, file_path, file_type, created_at, updated_at
       FROM documents
       WHERE file_path LIKE '%' || ${sqlQuote(suffix)}
       ORDER BY updated_at DESC
       LIMIT 1`
    );
    if (fuzzy.length > 0) return fuzzy[0];
    throw new Error(`document not found by path: ${byPath}`);
  }

  if (byTitle) {
    const rows = runSqlJson(
      dbPath,
      `SELECT id, title, author, language, file_path, file_type, created_at, updated_at
       FROM documents
       WHERE title LIKE '%' || ${sqlQuote(byTitle)} || '%'
       ORDER BY updated_at DESC
       LIMIT 1`
    );
    if (rows.length > 0) return rows[0];
    throw new Error(`document not found by title: ${byTitle}`);
  }

  throw new Error('Provide one of: doc_id, path, title');
}

function listDocuments(_root, args) {
  const dbPath = resolveDbPath(args);
  const limit = Number.isInteger(args?.limit) ? Math.min(Math.max(args.limit, 1), 500) : 100;
  const requestedTypes = Array.isArray(args?.file_types)
    ? args.file_types
    : ['markdown', 'pdf', 'epub'];
  const normalizedTypes = requestedTypes
    .map((t) => String(t || '').trim().toLowerCase())
    .filter((t) => t === 'markdown' || t === 'pdf' || t === 'epub');
  const types = normalizedTypes.length > 0 ? normalizedTypes : ['markdown', 'pdf', 'epub'];
  const typeList = types.map((t) => sqlQuote(t)).join(', ');
  const where = `d.file_type IN (${typeList})`;

  const rows = runSqlJson(
    dbPath,
    `SELECT
      d.id,
      d.title,
      d.author,
      d.language,
      d.file_path,
      d.file_type,
      d.created_at,
      d.updated_at,
      (SELECT COUNT(*) FROM sections s WHERE s.doc_id = d.id) AS section_count,
      (SELECT COUNT(*) FROM paragraphs p WHERE p.doc_id = d.id) AS paragraph_count
     FROM documents d
     WHERE ${where}
     ORDER BY d.updated_at DESC
     LIMIT ${limit}`
  );

  return {
    db_path: dbPath,
    file_types: types,
    documents: rows,
    total: rows.length,
  };
}

function openDocument(root, args) {
  const dbPath = resolveDbPath(args);
  const doc = resolveDocument(dbPath, root, args);
  const maxChars = Number.isInteger(args?.max_chars)
    ? Math.min(Math.max(args.max_chars, 200), 400000)
    : 12000;

  const paragraphs = runSqlJson(
    dbPath,
    `SELECT
      p.id,
      p.section_id,
      p.order_index,
      p.text,
      p.location,
      s.title AS section_title,
      s.order_index AS section_order
     FROM paragraphs p
     JOIN sections s ON s.id = p.section_id
     WHERE p.doc_id = ${sqlQuote(doc.id)}
     ORDER BY s.order_index ASC, p.order_index ASC`
  );

  const merged = paragraphs.map((p) => p.text || '').join('\n\n');
  return {
    db_path: dbPath,
    document: doc,
    paragraph_count: paragraphs.length,
    total_chars: merged.length,
    truncated: merged.length > maxChars,
    content: merged.slice(0, maxChars),
  };
}

function getDocumentOutline(root, args) {
  const dbPath = resolveDbPath(args);
  const doc = resolveDocument(dbPath, root, args);
  const sections = runSqlJson(
    dbPath,
    `SELECT id, title, order_index, href
     FROM sections
     WHERE doc_id = ${sqlQuote(doc.id)}
     ORDER BY order_index ASC`
  );

  return {
    db_path: dbPath,
    document: doc,
    sections,
    section_count: sections.length,
  };
}

function searchDocument(root, args) {
  const dbPath = resolveDbPath(args);
  const query = String(args?.query || '').trim();
  if (!query) {
    throw new Error('query is required');
  }

  const limit = Number.isInteger(args?.limit) ? Math.min(Math.max(args.limit, 1), 200) : 20;
  const caseSensitive = Boolean(args?.case_sensitive);

  const hasDocSelector = Boolean(args?.doc_id || args?.path || args?.title);
  const doc = hasDocSelector ? resolveDocument(dbPath, root, args) : null;

  const queryExpr = caseSensitive
    ? `instr(p.text, ${sqlQuote(query)}) > 0`
    : `instr(lower(p.text), lower(${sqlQuote(query)})) > 0`;

  const docFilter = doc ? `AND p.doc_id = ${sqlQuote(doc.id)}` : '';

  const rows = runSqlJson(
    dbPath,
    `SELECT
      p.id AS paragraph_id,
      p.doc_id,
      d.title AS document_title,
      s.title AS section_title,
      p.location,
      p.text
     FROM paragraphs p
     JOIN documents d ON d.id = p.doc_id
     JOIN sections s ON s.id = p.section_id
     WHERE ${queryExpr}
     ${docFilter}
     ORDER BY d.updated_at DESC, s.order_index ASC, p.order_index ASC
     LIMIT ${limit}`
  );

  return {
    db_path: dbPath,
    query,
    document_scope: doc ? { id: doc.id, title: doc.title } : null,
    results: rows,
    total_matches: rows.length,
  };
}

function candidateConfigPaths() {
  const home = os.homedir();
  return [
    process.env.READER_CONFIG_PATH,
    path.join(home, 'Library', 'Application Support', 'reader', 'config.json'),
    path.join(home, '.config', 'reader', 'config.json'),
  ].filter(Boolean);
}

function loadReaderConfig() {
  for (const p of candidateConfigPaths()) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Ignore invalid config file and continue with defaults.
    }
  }
  return {};
}

function normalizeAiProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'lmstudio') return normalized;
  return 'lmstudio';
}

function resolveChatRuntime(args = {}) {
  const config = loadReaderConfig();
  const provider = normalizeAiProvider(args?.provider || config.provider || 'lmstudio');
  const model = String(args?.chat_model || config.chat_model || '').trim();
  if (!model) {
    throw new Error(
      'Missing chat model. Configure Reader chat_model in config, or pass --chat-model.'
    );
  }

  if (provider === 'openai') {
    const baseUrl = String(
      args?.openai_base_url || config.openai_base_url || 'https://api.openai.com/v1'
    )
      .trim()
      .replace(/\/+$/, '');
    const apiKey = String(
      args?.openai_api_key || config.openai_api_key || process.env.OPENAI_API_KEY || ''
    ).trim();
    if (!apiKey) {
      throw new Error('Missing OpenAI API key. Set config/openai_api_key or OPENAI_API_KEY.');
    }
    return { provider, baseUrl, apiKey, model };
  }

  const baseUrl = String(args?.lm_studio_url || config.lm_studio_url || 'http://localhost:1234/v1')
    .trim()
    .replace(/\/+$/, '');
  return { provider: 'lmstudio', baseUrl, apiKey: '', model };
}

async function chatCompletion(args, messages, opts = {}) {
  const runtime = resolveChatRuntime(args);
  const payload = {
    model: runtime.model,
    messages,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3,
    max_tokens: Number.isInteger(opts.maxTokens) ? opts.maxTokens : 1200,
  };
  const headers = { 'content-type': 'application/json' };
  if (runtime.provider === 'openai') {
    headers.authorization = `Bearer ${runtime.apiKey}`;
  }

  const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chat completion failed (${response.status}): ${text.slice(0, 500)}`);
  }
  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('Chat completion returned empty content');
  }
  return content.trim();
}

function resolveContextText(dbPath, root, args, options = {}) {
  const maxDocumentParagraphs = Number.isInteger(options?.maxDocumentParagraphs)
    ? options.maxDocumentParagraphs
    : 180;
  const maxChars = Number.isInteger(options?.maxChars) ? options.maxChars : 24000;

  const paragraphId = String(args?.paragraph_id || '').trim();
  const sectionId = String(args?.section_id || '').trim();
  const hasDocSelector = Boolean(args?.doc_id || args?.path || args?.title);

  if (paragraphId) {
    const rows = runSqlJson(
      dbPath,
      `SELECT p.text, p.doc_id, p.section_id, d.title AS document_title, s.title AS section_title
       FROM paragraphs p
       JOIN documents d ON d.id = p.doc_id
       JOIN sections s ON s.id = p.section_id
       WHERE p.id = ${sqlQuote(paragraphId)}
       LIMIT 1`
    );
    const row = rows[0];
    if (!row) throw new Error(`paragraph not found: ${paragraphId}`);
    const text = String(row.text || '');
    return {
      scope: 'paragraph',
      scope_label: 'Current paragraph',
      doc_id: row.doc_id,
      section_id: row.section_id,
      document_title: row.document_title || null,
      section_title: row.section_title || null,
      content: text.slice(0, maxChars),
      truncated: text.length > maxChars,
    };
  }

  if (sectionId) {
    const sectionRows = runSqlJson(
      dbPath,
      `SELECT s.id, s.doc_id, s.title, d.title AS document_title
       FROM sections s
       JOIN documents d ON d.id = s.doc_id
       WHERE s.id = ${sqlQuote(sectionId)}
       LIMIT 1`
    );
    const section = sectionRows[0];
    if (!section) throw new Error(`section not found: ${sectionId}`);
    const paragraphs = runSqlJson(
      dbPath,
      `SELECT text
       FROM paragraphs
       WHERE section_id = ${sqlQuote(sectionId)}
       ORDER BY order_index ASC`
    );
    const text = paragraphs.map((p) => p.text || '').join('\n\n');
    if (!text.trim()) throw new Error(`section has no content: ${sectionId}`);
    return {
      scope: 'section',
      scope_label: 'Current section',
      doc_id: section.doc_id,
      section_id: section.id,
      document_title: section.document_title || null,
      section_title: section.title || null,
      content: text.slice(0, maxChars),
      truncated: text.length > maxChars,
    };
  }

  if (!hasDocSelector) {
    throw new Error(
      'Provide one context selector: paragraph_id, section_id, or one of doc_id/path/title.'
    );
  }

  const doc = resolveDocument(dbPath, root, args);
  const paragraphs = runSqlJson(
    dbPath,
    `SELECT text
     FROM paragraphs
     WHERE doc_id = ${sqlQuote(doc.id)}
     ORDER BY order_index ASC
     LIMIT ${maxDocumentParagraphs}`
  );
  const text = paragraphs.map((p) => p.text || '').join('\n\n');
  if (!text.trim()) throw new Error(`document has no content: ${doc.id}`);
  return {
    scope: 'document',
    scope_label: 'Current document',
    doc_id: doc.id,
    section_id: null,
    document_title: doc.title || null,
    section_title: null,
    content: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}

function stripThinkingContent(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

async function summarizeContext(root, args) {
  const dbPath = resolveDbPath(args);
  const style = String(args?.style || 'brief').trim().toLowerCase();
  if (!['brief', 'detailed', 'bullet'].includes(style)) {
    throw new Error(`Invalid style: ${style}. Use brief/detailed/bullet.`);
  }
  const context = resolveContextText(dbPath, root, args, { maxDocumentParagraphs: 180 });
  const systemPromptByStyle = {
    brief:
      'You are a skilled summarizer. Create a brief summary in 1-2 sentences. Output summary only.',
    detailed:
      'You are a skilled summarizer. Create a detailed multi-paragraph summary covering key points. Output summary only.',
    bullet:
      'You are a skilled summarizer. Summarize as concise bullet points. Output bullets only.',
  };
  const output = await chatCompletion(
    args,
    [
      { role: 'system', content: systemPromptByStyle[style] },
      { role: 'user', content: context.content },
    ],
    { temperature: 0.5, maxTokens: style === 'brief' ? 300 : style === 'detailed' ? 2000 : 1000 }
  );
  return {
    db_path: dbPath,
    style,
    scope: context.scope,
    doc_id: context.doc_id,
    section_id: context.section_id,
    truncated_context: context.truncated,
    summary: stripThinkingContent(output),
  };
}

async function translateTextWithReaderConfig(_root, args) {
  const text = String(args?.text || '').trim();
  if (!text) throw new Error('text is required');
  const targetLang = String(args?.target_lang || '').trim().toLowerCase();
  if (!targetLang) throw new Error('target_lang is required');
  const targetLangName = targetLang === 'zh' ? 'Chinese' : targetLang === 'en' ? 'English' : targetLang;
  const output = await chatCompletion(
    args,
    [
      {
        role: 'system',
        content:
          `You are a professional translator. Translate text to ${targetLangName}. ` +
          'If input contains Markdown, preserve Markdown structure. Output translation only.',
      },
      { role: 'user', content: text },
    ],
    { temperature: 0.3, maxTokens: 2000 }
  );
  return {
    target_lang: targetLang,
    translation: stripThinkingContent(output),
  };
}

async function deepAnalyzeContext(root, args) {
  const dbPath = resolveDbPath(args);
  const context = resolveContextText(dbPath, root, args, { maxDocumentParagraphs: 180 });
  const prompt = `你是一个严格的“信息深度分析引擎”。请仅基于给定文本输出 Markdown，禁止臆测。

必须输出以下章节（按顺序）：
## 1) 概念清单（中英文）
## 2) 概念定义（中英文）
## 3) 概念关系（中英文）
## 4) COT逻辑梳理（显式步骤）
## 5) 事实与看法
## 6) FAQ（由文中问题整理）
## 7) Visualization（包含 mermaid）
## 8) 类比清单
## 9) 金句（10条）

输出要求：
- 中文为主，概念名中英双语
- 禁止输出与文本无关内容
- 保持结构化层级`;

  const output = await chatCompletion(
    args,
    [
      { role: 'system', content: prompt },
      { role: 'user', content: context.content },
    ],
    { temperature: 0.3, maxTokens: 3600 }
  );
  return {
    db_path: dbPath,
    scope: context.scope,
    doc_id: context.doc_id,
    section_id: context.section_id,
    truncated_context: context.truncated,
    analysis: stripThinkingContent(output),
  };
}

async function chatWithContext(root, args) {
  const dbPath = resolveDbPath(args);
  const question = String(args?.question || '').trim();
  if (!question) throw new Error('question is required');
  const context = resolveContextText(dbPath, root, args, { maxDocumentParagraphs: 180 });
  const history = Array.isArray(args?.history) ? args.history : [];
  const historyMessages = history
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      role: String(item.role || '').trim().toLowerCase(),
      content: String(item.content || '').trim(),
    }))
    .filter((item) => (item.role === 'user' || item.role === 'assistant') && item.content)
    .slice(-8);

  const output = await chatCompletion(
    args,
    [
      {
        role: 'system',
        content:
          'You are a reading assistant for QA over a document context. Answer only with provided context. If insufficient, explicitly say what is missing.',
      },
      {
        role: 'system',
        content: `Context scope: ${context.scope_label}\nContext content:\n${context.content}`,
      },
      ...historyMessages,
      { role: 'user', content: question },
    ],
    { temperature: 0.2, maxTokens: 1200 }
  );

  return {
    db_path: dbPath,
    scope: context.scope,
    doc_id: context.doc_id,
    section_id: context.section_id,
    truncated_context: context.truncated,
    answer: stripThinkingContent(output),
  };
}

function normalizeEmbeddingProfile(dbPath, args, config) {
  const fromArgs = args?.embedding_profile || {};
  const provider = String(
    fromArgs.provider || args?.embedding_provider || config.embedding_provider || ''
  ).trim();
  const model = String(fromArgs.model || args?.embedding_model || config.embedding_model || '').trim();
  const dimensionRaw =
    fromArgs.dimension ?? args?.embedding_dimension ?? config.embedding_dimension ?? null;
  const dimension = Number.isInteger(dimensionRaw)
    ? Number(dimensionRaw)
    : Number.parseInt(String(dimensionRaw || ''), 10);

  if (provider && model && Number.isInteger(dimension) && dimension > 0) {
    return { provider, model, dimension };
  }

  const rows = runSqlJson(
    dbPath,
    `SELECT provider, model, dim, COUNT(*) AS cnt
     FROM embeddings
     GROUP BY provider, model, dim
     ORDER BY cnt DESC
     LIMIT 1`
  );
  if (rows.length === 0) {
    throw new Error(
      'No embeddings found in reader.db. Please build the embedding index first, then retry.'
    );
  }
  const row = rows[0];
  return {
    provider: String(row.provider || ''),
    model: String(row.model || ''),
    dimension: Number(row.dim || 0),
  };
}

function normalizeTypes(types) {
  if (!Array.isArray(types)) return [];
  return types
    .map((t) => String(t || '').trim().toLowerCase())
    .filter((t) => t === 'markdown' || t === 'pdf' || t === 'epub');
}

function buildSemanticScope(dbPath, root, args) {
  const filters = [];
  const hasDocSelector = Boolean(args?.doc_id || args?.path || args?.title);
  let docScope = null;
  if (hasDocSelector) {
    const doc = resolveDocument(dbPath, root, args);
    filters.push(`p.doc_id = ${sqlQuote(doc.id)}`);
    docScope = { id: doc.id, title: doc.title };
  }

  const fileTypes = normalizeTypes(args?.file_types);
  if (fileTypes.length > 0) {
    const typeList = fileTypes.map((t) => sqlQuote(t)).join(', ');
    filters.push(`d.file_type IN (${typeList})`);
  }

  return {
    filterSql: filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '',
    docScope,
    fileTypes: fileTypes.length > 0 ? fileTypes : null,
  };
}

function vectorFromHex(hex) {
  if (!hex) return [];
  const buf = Buffer.from(String(hex), 'hex');
  if (buf.length % 4 !== 0) return [];
  const vec = new Array(buf.length / 4);
  for (let i = 0; i < vec.length; i += 1) {
    vec[i] = buf.readFloatLE(i * 4);
  }
  return vec;
}

function vectorNorm(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const v = vec[i];
    sum += v * v;
  }
  return Math.sqrt(sum);
}

function cosineSimilarityWithNorm(queryVec, queryNorm, vec) {
  if (!Array.isArray(vec) || vec.length !== queryVec.length || queryVec.length === 0) {
    return -1;
  }
  let dot = 0;
  let vecNormSq = 0;
  for (let i = 0; i < queryVec.length; i += 1) {
    const q = queryVec[i];
    const v = vec[i];
    dot += q * v;
    vecNormSq += v * v;
  }
  const denom = queryNorm * Math.sqrt(vecNormSq);
  if (!Number.isFinite(denom) || denom <= 0) return -1;
  return dot / denom;
}

function snippetText(text, max = 240) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}...`;
}

async function embedQueryWithOpenAICompatible(query, opts) {
  const base = String(opts?.baseUrl || '').trim();
  const model = String(opts?.model || '').trim();
  if (!base || !model) {
    throw new Error('Missing baseUrl/model for OpenAI-compatible embeddings');
  }
  const endpoint = `${base.replace(/\/+$/, '')}/embeddings`;
  const headers = { 'content-type': 'application/json' };
  if (opts?.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: query }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Embedding API failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const data = await response.json();
  const vec = data?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new Error('Embedding API returned empty vector');
  }
  return vec.map((v) => Number(v));
}

async function embedQueryWithOllama(query, opts) {
  const base = String(opts?.baseUrl || 'http://localhost:11434').trim().replace(/\/+$/, '');
  const model = String(opts?.model || '').trim();
  if (!model) throw new Error('Missing ollama model for embedding');

  const tryEndpoints = [
    {
      url: `${base}/api/embed`,
      body: { model, input: [query] },
      pick: (json) => json?.embeddings?.[0],
    },
    {
      url: `${base}/api/embeddings`,
      body: { model, prompt: query },
      pick: (json) => json?.embedding,
    },
  ];

  let lastError = null;
  for (const item of tryEndpoints) {
    try {
      const response = await fetch(item.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item.body),
      });
      if (!response.ok) {
        const text = await response.text();
        lastError = `Ollama ${item.url} failed (${response.status}): ${text.slice(0, 300)}`;
        continue;
      }
      const json = await response.json();
      const vec = item.pick(json);
      if (Array.isArray(vec) && vec.length > 0) {
        return vec.map((v) => Number(v));
      }
      lastError = `Ollama ${item.url} returned empty embedding`;
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  throw new Error(lastError || 'Ollama embedding failed');
}

function resolveLocalModelSpec(localModelPath) {
  const raw = String(localModelPath || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/^file:\/\//, '').replace(/\\/g, '/').replace(/\/+$/, '');
  const modelDir = normalized.endsWith('/config.json')
    ? normalized.slice(0, -'/config.json'.length)
    : normalized;
  const modelName = path.basename(modelDir);
  const parentDir = path.dirname(modelDir);
  if (!modelName || !parentDir) return null;
  return { modelName, parentDir };
}

let localExtractorKey = '';
let localExtractor = null;
async function embedQueryWithLocalTransformers(query, opts) {
  const { env, pipeline } = await import('@xenova/transformers');
  env.allowLocalModels = true;
  env.useBrowserCache = false;

  let modelName = String(opts?.model || '').trim();
  const localSpec = resolveLocalModelSpec(opts?.localModelPath);
  let initOptions = {};

  if (localSpec) {
    modelName = localSpec.modelName;
    env.localModelPath = localSpec.parentDir;
    env.allowRemoteModels = false;
    initOptions = { local_files_only: true };
  } else {
    env.allowRemoteModels = true;
  }

  if (!modelName) {
    throw new Error('Missing model for local_transformers embedding');
  }

  const key = `${modelName}|${env.localModelPath || ''}|${env.allowRemoteModels ? 'remote' : 'local'}`;
  if (!localExtractor || localExtractorKey !== key) {
    localExtractor = await pipeline('feature-extraction', modelName, initOptions);
    localExtractorKey = key;
  }

  const out = await localExtractor(query, { pooling: 'mean', normalize: true });
  const arr = Array.from(out?.data || []);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('local_transformers produced empty query embedding');
  }
  return arr.map((v) => Number(v));
}

async function resolveSemanticQueryVector(query, args, profile, config) {
  if (Array.isArray(args?.query_vector) && args.query_vector.length > 0) {
    return args.query_vector.map((v) => Number(v));
  }

  if (!query) {
    throw new Error('query is required when query_vector is not provided');
  }

  const provider = String(profile.provider || '').trim();
  if (provider === 'lmstudio') {
    return embedQueryWithOpenAICompatible(query, {
      baseUrl: args?.lm_studio_url || config.lm_studio_url || 'http://localhost:1234/v1',
      model: profile.model,
      apiKey: args?.lm_studio_api_key || null,
    });
  }
  if (provider === 'openai_compatible') {
    return embedQueryWithOpenAICompatible(query, {
      baseUrl: args?.openai_base_url || config.openai_base_url || 'https://api.openai.com/v1',
      model: profile.model,
      apiKey: args?.openai_api_key || config.openai_api_key || process.env.OPENAI_API_KEY || '',
    });
  }
  if (provider === 'ollama') {
    return embedQueryWithOllama(query, {
      baseUrl: args?.embedding_ollama_url || config.embedding_ollama_url || 'http://localhost:11434',
      model: args?.embedding_ollama_model || profile.model,
    });
  }
  if (provider === 'local_transformers') {
    return embedQueryWithLocalTransformers(query, {
      model: profile.model,
      localModelPath: args?.local_model_path || config.embedding_local_model_path || '',
    });
  }

  throw new Error(
    `Unsupported embedding provider '${provider}'. Use query_vector or set provider to local_transformers/lmstudio/openai_compatible/ollama.`
  );
}

async function semanticSearchDocuments(root, args) {
  const dbPath = resolveDbPath(args);
  const query = String(args?.query || '').trim();
  const topK = Number.isInteger(args?.top_k) ? Math.min(Math.max(args.top_k, 1), 200) : 10;
  const scanLimit = Number.isInteger(args?.scan_limit)
    ? Math.min(Math.max(args.scan_limit, topK), 200000)
    : 20000;
  const batchSize = Number.isInteger(args?.batch_size)
    ? Math.min(Math.max(args.batch_size, 200), 5000)
    : 2000;
  const minScore =
    typeof args?.min_score === 'number' && Number.isFinite(args.min_score)
      ? Number(args.min_score)
      : -1;

  const config = loadReaderConfig();
  const profile = normalizeEmbeddingProfile(dbPath, args, config);
  const scope = buildSemanticScope(dbPath, root, args);
  const queryVector = await resolveSemanticQueryVector(query, args, profile, config);

  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    throw new Error('query embedding vector is empty');
  }
  if (queryVector.length !== profile.dimension) {
    throw new Error(
      `Query vector dimension mismatch: expected ${profile.dimension}, got ${queryVector.length}`
    );
  }

  const baseWhere =
    `e.provider = ${sqlQuote(profile.provider)} ` +
    `AND e.model = ${sqlQuote(profile.model)} ` +
    `AND e.dim = ${profile.dimension}` +
    scope.filterSql;

  const totalRows = runSqlJson(
    dbPath,
    `SELECT COUNT(*) AS total
     FROM embeddings e
     JOIN paragraphs p ON p.id = e.paragraph_id
     JOIN documents d ON d.id = p.doc_id
     WHERE ${baseWhere}`
  );
  const totalCandidates = Number(totalRows?.[0]?.total || 0);
  if (totalCandidates === 0) {
    return {
      db_path: dbPath,
      query,
      profile,
      top_k: topK,
      total_candidates: 0,
      scanned_candidates: 0,
      truncated_scan: false,
      document_scope: scope.docScope,
      file_types: scope.fileTypes,
      results: [],
    };
  }

  const queryNorm = vectorNorm(queryVector);
  const scored = [];
  let scannedCandidates = 0;
  let offset = 0;
  while (scannedCandidates < scanLimit) {
    const currentLimit = Math.min(batchSize, scanLimit - scannedCandidates);
    const rows = runSqlJson(
      dbPath,
      `SELECT e.paragraph_id, hex(e.vector) AS vector_hex
       FROM embeddings e
       JOIN paragraphs p ON p.id = e.paragraph_id
       JOIN documents d ON d.id = p.doc_id
       WHERE ${baseWhere}
       ORDER BY e.created_at DESC
       LIMIT ${currentLimit} OFFSET ${offset}`,
      { maxBuffer: 64 * 1024 * 1024 }
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const vec = vectorFromHex(row.vector_hex);
      const score = cosineSimilarityWithNorm(queryVector, queryNorm, vec);
      if (!Number.isFinite(score) || score < minScore) continue;
      scored.push({ paragraph_id: row.paragraph_id, score });
    }

    scannedCandidates += rows.length;
    offset += rows.length;
    if (scored.length > topK * 8) {
      scored.sort((a, b) => b.score - a.score);
      scored.length = topK * 4;
    }

    if (rows.length < currentLimit) break;
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  if (top.length === 0) {
    return {
      db_path: dbPath,
      query,
      profile,
      top_k: topK,
      total_candidates: totalCandidates,
      scanned_candidates: scannedCandidates,
      truncated_scan: totalCandidates > scannedCandidates,
      document_scope: scope.docScope,
      file_types: scope.fileTypes,
      results: [],
    };
  }

  const idList = top.map((item) => sqlQuote(item.paragraph_id)).join(', ');
  const details = runSqlJson(
    dbPath,
    `SELECT
      p.id AS paragraph_id,
      p.doc_id,
      d.title AS document_title,
      d.file_type,
      s.title AS section_title,
      p.location,
      p.text
     FROM paragraphs p
     JOIN documents d ON d.id = p.doc_id
     JOIN sections s ON s.id = p.section_id
     WHERE p.id IN (${idList})`
  );
  const detailMap = new Map(details.map((row) => [row.paragraph_id, row]));

  const results = top
    .map((item) => {
      const row = detailMap.get(item.paragraph_id);
      if (!row) return null;
      return {
        paragraph_id: item.paragraph_id,
        doc_id: row.doc_id,
        document_title: row.document_title,
        file_type: row.file_type,
        section_title: row.section_title,
        location: row.location,
        score: item.score,
        snippet: snippetText(row.text),
      };
    })
    .filter(Boolean);

  return {
    db_path: dbPath,
    query,
    profile,
    top_k: topK,
    total_candidates: totalCandidates,
    scanned_candidates: scannedCandidates,
    truncated_scan: totalCandidates > scannedCandidates,
    document_scope: scope.docScope,
    file_types: scope.fileTypes,
    results,
  };
}

function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.epub') return 'epub';
  return 'unknown';
}

function markdownTitle(raw, fallbackTitle) {
  const m = raw.match(/^#\s+(.+)$/m);
  if (m && m[1].trim()) return m[1].trim();
  return fallbackTitle;
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function splitParagraphs(text) {
  const normalized = text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];
  return normalized
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

function parseMarkdownSections(raw, docTitle) {
  const lines = raw.split(/\r?\n/);
  const sections = [];
  let current = null;
  let hasHeading = false;

  const flushCurrent = () => {
    if (!current) return;
    const body = current.lines.join('\n').trim();
    sections.push({
      title: current.title || docTitle,
      paragraphs: splitParagraphs(body),
    });
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      hasHeading = true;
      flushCurrent();
      current = { title: heading[1].trim(), lines: [] };
      continue;
    }
    if (!current) current = { title: docTitle, lines: [] };
    current.lines.push(line);
  }
  flushCurrent();

  if (!hasHeading && sections.length === 0) {
    const text = raw.trim();
    return [{ title: docTitle, paragraphs: text ? [text] : [] }];
  }

  if (sections.length === 0) {
    return [{ title: docTitle, paragraphs: [] }];
  }

  return sections;
}

function parsePdfSections(absPath) {
  const raw = execFileSync('pdftotext', ['-enc', 'UTF-8', '-q', absPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 80 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pages = raw.split('\f');
  const sections = [];

  for (let i = 0; i < pages.length; i += 1) {
    const pageText = pages[i].trim();
    const paragraphs = splitParagraphs(pageText);
    if (paragraphs.length === 0) continue;
    sections.push({ title: `Page ${i + 1}`, paragraphs });
  }

  if (sections.length === 0) {
    return [{ title: 'Page 1', paragraphs: [] }];
  }
  return sections;
}

function listZipEntries(absPath) {
  const out = execFileSync('unzip', ['-Z1', absPath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function unzipReadText(absPath, entryPath) {
  return execFileSync('unzip', ['-p', absPath, entryPath], {
    encoding: 'utf8',
    maxBuffer: 80 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function stripHtmlToText(html) {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withBreaks = noScript
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n');
  const text = withBreaks
    .replace(/<[^>]+>/g, ' ')
    .split(/\r?\n/)
    .map((line) => decodeHtmlEntities(line).replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return text.trim();
}

function parseEpubMetadata(absPath, entries) {
  let title = null;
  let author = null;
  let language = null;
  let opfPath = null;

  const containerPath = entries.find((e) => e.toLowerCase() === 'meta-inf/container.xml');
  if (containerPath) {
    const containerXml = unzipReadText(absPath, containerPath);
    const m = containerXml.match(/full-path\s*=\s*"([^"]+)"/i);
    if (m) opfPath = m[1];
  }

  if (opfPath && entries.includes(opfPath)) {
    const opf = unzipReadText(absPath, opfPath);
    const t = opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
    const a = opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
    const l = opf.match(/<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i);
    if (t) title = decodeHtmlEntities(t[1].replace(/<[^>]+>/g, '').trim()) || null;
    if (a) author = decodeHtmlEntities(a[1].replace(/<[^>]+>/g, '').trim()) || null;
    if (l) language = decodeHtmlEntities(l[1].replace(/<[^>]+>/g, '').trim()) || null;

    const opfDir = path.posix.dirname(opfPath);
    const manifest = new Map();
    const itemRegex = /<item\s+[^>]*id\s*=\s*"([^"]+)"[^>]*href\s*=\s*"([^"]+)"[^>]*>/gi;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(opf)) !== null) {
      manifest.set(itemMatch[1], path.posix.normalize(path.posix.join(opfDir, itemMatch[2])));
    }

    const ordered = [];
    const itemRefRegex = /<itemref\s+[^>]*idref\s*=\s*"([^"]+)"[^>]*>/gi;
    let refMatch;
    while ((refMatch = itemRefRegex.exec(opf)) !== null) {
      const file = manifest.get(refMatch[1]);
      if (file && entries.includes(file)) ordered.push(file);
    }

    return { title, author, language, chapterFiles: ordered, opfPath };
  }

  return { title, author, language, chapterFiles: [], opfPath: null };
}

function parseEpubSections(absPath, fileNameFallback) {
  const entries = listZipEntries(absPath);
  const meta = parseEpubMetadata(absPath, entries);

  let chapterFiles = meta.chapterFiles;
  if (chapterFiles.length === 0) {
    chapterFiles = entries
      .filter((e) => /\.(xhtml|html|htm)$/i.test(e))
      .filter((e) => !/toc|nav|cover/i.test(path.basename(e)))
      .sort();
  }

  const sections = [];
  for (const chapter of chapterFiles) {
    let html;
    try {
      html = unzipReadText(absPath, chapter);
    } catch {
      continue;
    }

    const heading = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    const chapterTitle = heading
      ? decodeHtmlEntities(heading[1].replace(/<[^>]+>/g, '').trim())
      : path.basename(chapter, path.extname(chapter));

    const text = stripHtmlToText(html);
    const paragraphs = splitParagraphs(text);
    if (paragraphs.length === 0) continue;
    sections.push({ title: chapterTitle || 'Chapter', paragraphs });
  }

  if (sections.length === 0) {
    sections.push({ title: fileNameFallback, paragraphs: [] });
  }

  return {
    title: meta.title,
    author: meta.author,
    language: meta.language,
    sections,
  };
}

function importDocument(root, args) {
  const dbPath = resolveDbPath(args);
  const fileArg = String(args?.path || '').trim();
  if (!fileArg) {
    throw new Error('path is required');
  }

  const absPath = path.isAbsolute(fileArg) ? fileArg : path.resolve(root, fileArg);
  if (!fs.existsSync(absPath)) {
    throw new Error(`file not found: ${absPath}`);
  }

  const fileType = detectFileType(absPath);
  if (!['markdown', 'pdf', 'epub'].includes(fileType)) {
    throw new Error(`unsupported file type: ${fileType}. supported: markdown/pdf/epub`);
  }

  const forceReimport = Boolean(args?.force_reimport);
  const existingRows = runSqlJson(
    dbPath,
    `SELECT id, title, author, language, file_path, file_type, created_at, updated_at
     FROM documents
     WHERE file_path = ${sqlQuote(absPath)}
     LIMIT 1`
  );
  const existing = existingRows[0] || null;

  if (existing && !forceReimport) {
    return {
      db_path: dbPath,
      status: 'exists',
      document: existing,
      imported: false,
      message: 'Document already exists. Set force_reimport=true to re-import.',
    };
  }

  const fallbackTitle = path.basename(absPath, path.extname(absPath));
  let autoTitle = fallbackTitle;
  let autoAuthor = null;
  let autoLanguage = null;
  let sections = [];

  if (fileType === 'markdown') {
    const raw = fs.readFileSync(absPath, 'utf8');
    autoTitle = markdownTitle(raw, fallbackTitle);
    sections = parseMarkdownSections(raw, autoTitle);
  } else if (fileType === 'pdf') {
    sections = parsePdfSections(absPath);
  } else {
    const parsed = parseEpubSections(absPath, fallbackTitle);
    autoTitle = parsed.title || fallbackTitle;
    autoAuthor = parsed.author;
    autoLanguage = parsed.language;
    sections = parsed.sections;
  }

  const title = String(args?.title || '').trim() || autoTitle || fallbackTitle;
  const author = args?.author ?? autoAuthor;
  const language = args?.language ?? autoLanguage;
  const now = Math.floor(Date.now() / 1000);
  const docId = randomUUID();

  const lines = [];
  lines.push('PRAGMA foreign_keys = ON;');
  lines.push('BEGIN IMMEDIATE;');
  if (existing) {
    lines.push(`DELETE FROM documents WHERE id = ${sqlQuote(existing.id)};`);
  }
  lines.push(
    `INSERT INTO documents (id, title, author, language, file_path, file_type, created_at, updated_at)
     VALUES (${sqlQuote(docId)}, ${sqlQuote(title)}, ${sqlNullable(author)}, ${sqlNullable(language)}, ${sqlQuote(absPath)}, ${sqlQuote(fileType)}, ${now}, ${now});`
  );

  for (let s = 0; s < sections.length; s += 1) {
    const sectionId = randomUUID();
    const href = `section${s + 1}`;
    const sectionTitle = sections[s].title || `Section ${s + 1}`;
    lines.push(
      `INSERT INTO sections (id, doc_id, title, order_index, href)
       VALUES (${sqlQuote(sectionId)}, ${sqlQuote(docId)}, ${sqlQuote(sectionTitle)}, ${s}, ${sqlQuote(href)});`
    );

    for (let p = 0; p < sections[s].paragraphs.length; p += 1) {
      const paragraphId = randomUUID();
      const text = sections[s].paragraphs[p];
      lines.push(
        `INSERT INTO paragraphs (id, doc_id, section_id, order_index, text, location)
         VALUES (${sqlQuote(paragraphId)}, ${sqlQuote(docId)}, ${sqlQuote(sectionId)}, ${p}, ${sqlQuote(text)}, ${sqlQuote(`${href}#p${p}`)});`
      );
    }
  }

  lines.push('COMMIT;');
  runSqlExec(dbPath, `${lines.join('\n')}\n`);

  const createdDoc = runSqlJson(
    dbPath,
    `SELECT id, title, author, language, file_path, file_type, created_at, updated_at
     FROM documents
     WHERE id = ${sqlQuote(docId)}
     LIMIT 1`
  )[0];

  return {
    db_path: dbPath,
    status: existing ? 'reimported' : 'imported',
    imported: true,
    document: createdDoc,
    section_count: sections.length,
    paragraph_count: sections.reduce((acc, sec) => acc + sec.paragraphs.length, 0),
  };
}

export function getTools() {
  return [
    {
      name: 'reader.list_documents',
      description: 'List documents from Reader SQLite database (supports markdown/pdf/epub)',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: { type: 'string', description: 'Optional reader.db path override' },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          file_types: {
            type: 'array',
            description: 'Optional file types filter. Default: [markdown, pdf, epub]',
            items: { type: 'string', enum: ['markdown', 'pdf', 'epub'] },
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'reader.open_document',
      description: 'Read document content from Reader SQLite (by doc_id/path/title)',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: { type: 'string', description: 'Optional reader.db path override' },
          doc_id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          max_chars: { type: 'integer', minimum: 200, maximum: 400000, default: 12000 },
        },
        anyOf: [{ required: ['doc_id'] }, { required: ['path'] }, { required: ['title'] }],
        additionalProperties: false,
      },
    },
    {
      name: 'reader.get_markdown_outline',
      description: 'Get section outline from Reader SQLite (by doc_id/path/title)',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: { type: 'string', description: 'Optional reader.db path override' },
          doc_id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
        },
        anyOf: [{ required: ['doc_id'] }, { required: ['path'] }, { required: ['title'] }],
        additionalProperties: false,
      },
    },
    {
      name: 'reader.search_markdown',
      description: 'Search paragraphs in Reader SQLite (optionally scoped to one document)',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: { type: 'string', description: 'Optional reader.db path override' },
          doc_id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          query: { type: 'string', minLength: 1 },
          case_sensitive: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'reader.semantic_search_documents',
      description:
        'Semantic similarity search across the embedding index (cross-document vector search)',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: { type: 'string', description: 'Optional reader.db path override' },
          query: {
            type: 'string',
            description: 'Natural-language query (used to generate query embedding)',
          },
          query_vector: {
            type: 'array',
            description: 'Optional precomputed query embedding vector',
            items: { type: 'number' },
          },
          top_k: { type: 'integer', minimum: 1, maximum: 200, default: 10 },
          min_score: { type: 'number', minimum: -1, maximum: 1, default: -1 },
          scan_limit: { type: 'integer', minimum: 10, maximum: 200000, default: 20000 },
          batch_size: { type: 'integer', minimum: 200, maximum: 5000, default: 2000 },
          doc_id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          file_types: {
            type: 'array',
            description: 'Optional file type filter',
            items: { type: 'string', enum: ['markdown', 'pdf', 'epub'] },
          },
          embedding_profile: {
            type: 'object',
            description: 'Optional explicit embedding profile override',
            properties: {
              provider: { type: 'string' },
              model: { type: 'string' },
              dimension: { type: 'integer', minimum: 1 },
            },
            additionalProperties: false,
          },
          embedding_provider: { type: 'string' },
          embedding_model: { type: 'string' },
          embedding_dimension: { type: 'integer', minimum: 1 },
          lm_studio_url: { type: 'string' },
          openai_base_url: { type: 'string' },
          openai_api_key: { type: 'string' },
          embedding_ollama_url: { type: 'string' },
          embedding_ollama_model: { type: 'string' },
          local_model_path: { type: 'string' },
        },
        anyOf: [{ required: ['query'] }, { required: ['query_vector'] }],
        additionalProperties: false,
      },
    },
    {
      name: 'reader.import_document',
      description: 'Import a local markdown/pdf/epub document into Reader SQLite',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: { type: 'string', description: 'Optional reader.db path override' },
          path: { type: 'string', minLength: 1 },
          title: { type: 'string', description: 'Optional title override' },
          author: { type: 'string', description: 'Optional author' },
          language: { type: 'string', description: 'Optional language code' },
          force_reimport: { type: 'boolean', default: false },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'reader.summarize_context',
      description: 'Summarize paragraph/section/document context using Reader AI config',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: { type: 'string' },
          doc_id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          section_id: { type: 'string' },
          paragraph_id: { type: 'string' },
          style: { type: 'string', enum: ['brief', 'detailed', 'bullet'], default: 'brief' },
          provider: { type: 'string', enum: ['lmstudio', 'openai'] },
          chat_model: { type: 'string' },
          lm_studio_url: { type: 'string' },
          openai_base_url: { type: 'string' },
          openai_api_key: { type: 'string' },
        },
        anyOf: [
          { required: ['paragraph_id'] },
          { required: ['section_id'] },
          { required: ['doc_id'] },
          { required: ['path'] },
          { required: ['title'] },
        ],
        additionalProperties: false,
      },
    },
    {
      name: 'reader.translate_text',
      description: 'Translate plain/markdown text with Reader AI config',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1 },
          target_lang: { type: 'string', minLength: 1 },
          provider: { type: 'string', enum: ['lmstudio', 'openai'] },
          chat_model: { type: 'string' },
          lm_studio_url: { type: 'string' },
          openai_base_url: { type: 'string' },
          openai_api_key: { type: 'string' },
        },
        required: ['text', 'target_lang'],
        additionalProperties: false,
      },
    },
    {
      name: 'reader.deep_analyze_context',
      description: 'Run deep analysis for paragraph/section/document context',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: { type: 'string' },
          doc_id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          section_id: { type: 'string' },
          paragraph_id: { type: 'string' },
          provider: { type: 'string', enum: ['lmstudio', 'openai'] },
          chat_model: { type: 'string' },
          lm_studio_url: { type: 'string' },
          openai_base_url: { type: 'string' },
          openai_api_key: { type: 'string' },
        },
        anyOf: [
          { required: ['paragraph_id'] },
          { required: ['section_id'] },
          { required: ['doc_id'] },
          { required: ['path'] },
          { required: ['title'] },
        ],
        additionalProperties: false,
      },
    },
    {
      name: 'reader.chat_with_context',
      description: 'Ask a question with paragraph/section/document context',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: { type: 'string' },
          question: { type: 'string', minLength: 1 },
          doc_id: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          section_id: { type: 'string' },
          paragraph_id: { type: 'string' },
          history: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
              additionalProperties: false,
            },
          },
          provider: { type: 'string', enum: ['lmstudio', 'openai'] },
          chat_model: { type: 'string' },
          lm_studio_url: { type: 'string' },
          openai_base_url: { type: 'string' },
          openai_api_key: { type: 'string' },
        },
        required: ['question'],
        anyOf: [
          { required: ['paragraph_id'] },
          { required: ['section_id'] },
          { required: ['doc_id'] },
          { required: ['path'] },
          { required: ['title'] },
        ],
        additionalProperties: false,
      },
    },
  ];
}

function getResourceDefinitions() {
  return [
    {
      uri: 'reader://project',
      name: 'Reader Project',
      description: 'Reader project MCP/runtime paths and flags',
      mimeType: 'application/json',
    },
    {
      uri: 'reader://database',
      name: 'Reader Database',
      description: 'Resolved reader.db path and table counters',
      mimeType: 'application/json',
    },
    {
      uri: 'reader://documents/recent',
      name: 'Recent Documents',
      description: 'Latest imported documents snapshot from reader.db',
      mimeType: 'application/json',
    },
  ];
}

function safeResolveDbPath() {
  try {
    return resolveDbPath({});
  } catch {
    return null;
  }
}

function readProjectResource(root) {
  const projectRoot = path.resolve(root);
  const configPath = path.join(projectRoot, '.mcp.json');
  const launcherPath = path.join(projectRoot, 'mcp-server', 'bin', 'reader-mcp-server.sh');
  return {
    project_root: projectRoot,
    config_path: configPath,
    config_exists: fs.existsSync(configPath),
    launcher_path: launcherPath,
    launcher_exists: fs.existsSync(launcherPath),
    db_path: safeResolveDbPath(),
  };
}

function readDatabaseResource() {
  const dbPath = resolveDbPath({});
  const counters = runSqlJson(
    dbPath,
    `SELECT
      (SELECT COUNT(*) FROM documents) AS documents,
      (SELECT COUNT(*) FROM sections) AS sections,
      (SELECT COUNT(*) FROM paragraphs) AS paragraphs,
      (SELECT COUNT(*) FROM embeddings) AS embeddings`
  )[0] || {
    documents: 0,
    sections: 0,
    paragraphs: 0,
    embeddings: 0,
  };
  return {
    db_path: dbPath,
    counts: counters,
  };
}

function readRecentDocumentsResource(limit = 20) {
  const dbPath = resolveDbPath({});
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 20;
  const rows = runSqlJson(
    dbPath,
    `SELECT id, title, author, language, file_path, file_type, updated_at
     FROM documents
     ORDER BY updated_at DESC
     LIMIT ${safeLimit}`
  );
  return {
    db_path: dbPath,
    limit: safeLimit,
    total: rows.length,
    documents: rows,
  };
}

function parseResourceUri(uri) {
  const raw = String(uri || '').trim();
  if (!raw) throw new Error('Resource uri is required');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid resource uri: ${raw}`);
  }
  if (parsed.protocol !== 'reader:') {
    throw new Error(`Unsupported resource protocol: ${parsed.protocol}`);
  }

  const pathPart = parsed.pathname === '/' ? '' : parsed.pathname;
  const baseUri = `reader://${parsed.host}${pathPart}`;
  return { baseUri, params: parsed.searchParams, raw };
}

export function getResources() {
  return getResourceDefinitions();
}

export function readResource(root, uri) {
  const { baseUri, params } = parseResourceUri(uri);
  if (baseUri === 'reader://project') {
    return readProjectResource(root);
  }
  if (baseUri === 'reader://database') {
    return readDatabaseResource();
  }
  if (baseUri === 'reader://documents/recent') {
    const limitRaw = params.get('limit');
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
    return readRecentDocumentsResource(limit);
  }
  throw new Error(`Unknown resource uri: ${baseUri}`);
}

export async function callTool(root, toolName, args) {
  if (toolName === 'reader.list_documents' || toolName === 'reader.list_markdown_documents') {
    return listDocuments(root, args);
  }
  if (toolName === 'reader.open_document' || toolName === 'reader.open_markdown_document') {
    return openDocument(root, args);
  }
  if (toolName === 'reader.get_markdown_outline') return getDocumentOutline(root, args);
  if (toolName === 'reader.search_markdown') return searchDocument(root, args);
  if (toolName === 'reader.semantic_search_documents') return semanticSearchDocuments(root, args);
  if (toolName === 'reader.import_document') return importDocument(root, args);
  if (toolName === 'reader.summarize_context') return summarizeContext(root, args);
  if (toolName === 'reader.translate_text') return translateTextWithReaderConfig(root, args);
  if (toolName === 'reader.deep_analyze_context') return deepAnalyzeContext(root, args);
  if (toolName === 'reader.chat_with_context') return chatWithContext(root, args);
  throw new Error(`Unknown tool: ${toolName}`);
}
