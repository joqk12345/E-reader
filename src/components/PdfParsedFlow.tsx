import React, { useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Paragraph } from '../types';
import type { TranslationMode } from '../store/useStore';
import { splitIntoSentences } from '../utils/sentences';

const PDF_IMAGE_MARKER_RE = /^\[\[PDF_IMAGE:(.+)\]\]$/;
const CAPTION_RE = /^(figure|fig\.?|table)\s*\d+[\s\.:\-]/i;

type PdfParsedFlowProps = {
  paragraphs: Paragraph[];
  pdfPath: string;
  readerFontSize: number;
  searchHighlightQuery: string;
  searchMatchedParagraphIds: string[];
  translationMode: TranslationMode;
  translations: Record<string, string>;
  onTranslateSentence: (paragraphId: string, sentence: string, index: number) => void;
};

type PageGroup = {
  page: number;
  items: Paragraph[];
};

type FlowNode =
  | { kind: 'text'; id: string; text: string; highlight: boolean }
  | { kind: 'table'; id: string; text: string; highlight: boolean }
  | { kind: 'formula'; id: string; text: string; highlight: boolean }
  | { kind: 'image'; id: string; path: string; caption?: string }
  | { kind: 'page-visual'; id: string; reason: 'missing-figure' | 'formula-fallback' | 'table-fallback' };

const parsePage = (location?: string): number => {
  if (!location) return 1;
  const m = location.match(/page(\d+)/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const parseImageMarker = (text: string): string | null => {
  const m = text.trim().match(PDF_IMAGE_MARKER_RE);
  if (!m) return null;
  const path = m[1]?.trim();
  return path || null;
};

const isCaption = (text: string): boolean => CAPTION_RE.test(text.trim());

const isTableLikeBlock = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed.includes('\n')) return false;
  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const spaced = lines.filter((line) => /\s{2,}/.test(line)).length;
  const numeric = lines.filter((line) => /\d/.test(line)).length;
  return spaced >= 1 && numeric >= 1;
};

const isFormulaLikeBlock = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  const mathChars = (trimmed.match(/[=+\-*/^_(){}\[\]∑∫√≈≠≤≥πλμσ]/g) || []).length;
  const asciiLetters = (trimmed.match(/[A-Za-z]/g) || []).length;
  const digits = (trimmed.match(/\d/g) || []).length;
  if (/[∑∫√≈≠≤≥]/.test(trimmed) && mathChars >= 3) return true;
  if (mathChars >= 6 && mathChars * 2 >= Math.max(6, asciiLetters + digits)) return true;
  if (/^\s*\(?\d+(\.\d+)?\)?\s*[:=].+/.test(trimmed)) return true;
  return false;
};

const isLikelyCorruptedText = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const replacement = (trimmed.match(/�/g) || []).length;
  const odd = (trimmed.match(/[^\x09\x0A\x0D\x20-\x7E\u4E00-\u9FFF]/g) || []).length;
  return replacement > 0 || (trimmed.length > 40 && odd > Math.floor(trimmed.length * 0.45));
};

const parseTableRows = (text: string): string[][] | null => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const rows = lines.map((line) =>
    line
      .split(/\t+|\s{2,}/)
      .map((cell) => cell.trim())
      .filter(Boolean)
  );

  if (rows.some((row) => row.length < 2)) return null;

  const colCount = rows[0].length;
  const aligned = rows.filter((row) => Math.abs(row.length - colCount) <= 1).length;
  if (aligned < Math.max(2, Math.floor(rows.length * 0.6))) return null;

  return rows;
};

const renderHighlight = (text: string, query: string): React.ReactNode => {
  const keyword = query.trim();
  if (!keyword) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'ig');
  const parts = text.split(regex);
  if (parts.length <= 1) return text;
  return parts.map((part, idx) =>
    part.toLowerCase() === keyword.toLowerCase() ? (
      <mark key={`m-${idx}`} className="rounded bg-yellow-200 px-0.5">
        {part}
      </mark>
    ) : (
      <span key={`t-${idx}`}>{part}</span>
    )
  );
};

const buildFlowNodes = (items: Paragraph[], matched: Set<string>): FlowNode[] => {
  const nodes: FlowNode[] = [];
  let hasImage = false;
  let addedFormulaFallback = false;
  let addedTableFallback = false;
  let addedFigureFallback = false;

  for (let i = 0; i < items.length; i += 1) {
    const p = items[i];
    const imagePath = parseImageMarker(p.text);

    if (imagePath) {
      let caption: string | undefined;
      const next = items[i + 1];
      if (next && isCaption(next.text)) {
        caption = next.text.trim();
        i += 1;
      } else {
        const prev = items[i - 1];
        if (prev && isCaption(prev.text)) {
          caption = prev.text.trim();
        }
      }
      nodes.push({ kind: 'image', id: p.id, path: imagePath, caption });
      hasImage = true;
      continue;
    }

    const text = p.text.trim();
    if (!text) continue;

    const highlight = matched.has(p.id);
    if (isTableLikeBlock(text)) {
      nodes.push({ kind: 'table', id: p.id, text, highlight });
      if (!addedTableFallback) {
        nodes.push({ kind: 'page-visual', id: `pv-table-${p.id}`, reason: 'table-fallback' });
        addedTableFallback = true;
      }
    } else if (isFormulaLikeBlock(text) || isLikelyCorruptedText(text)) {
      nodes.push({ kind: 'formula', id: p.id, text, highlight });
      if (!addedFormulaFallback) {
        nodes.push({ kind: 'page-visual', id: `pv-formula-${p.id}`, reason: 'formula-fallback' });
        addedFormulaFallback = true;
      }
    } else {
      nodes.push({ kind: 'text', id: p.id, text, highlight });
    }

    if (!hasImage && !addedFigureFallback && isCaption(text) && /^(figure|fig\.?)/i.test(text)) {
      nodes.push({ kind: 'page-visual', id: `pv-missing-fig-${p.id}`, reason: 'missing-figure' });
      addedFigureFallback = true;
    }
  }

  return nodes;
};

export const PdfParsedFlow: React.FC<PdfParsedFlowProps> = ({
  paragraphs,
  pdfPath,
  readerFontSize,
  searchHighlightQuery,
  searchMatchedParagraphIds,
  translationMode,
  translations,
  onTranslateSentence,
}) => {
  const matched = useMemo(() => new Set(searchMatchedParagraphIds), [searchMatchedParagraphIds]);

  const renderSentenceRows = (
    paragraphId: string,
    text: string,
    highlight: boolean,
    showOriginal: boolean,
    originalClassName: string
  ) => {
    return splitIntoSentences(text).map((sentence, index) => {
      const sentenceKey = `${paragraphId}_${index}`;
      return (
        <div key={sentenceKey} className="mb-2">
          {showOriginal && (
            <p
              className={originalClassName}
              style={{ fontSize: `${readerFontSize}px`, lineHeight: 1.95 }}
            >
              {renderHighlight(sentence, highlight ? searchHighlightQuery : '')}
            </p>
          )}
          {translationMode !== 'off' && (
            <div className={`${showOriginal ? 'ml-4 mt-1' : ''} flex items-center gap-2`}>
              {translations[sentenceKey] ? (
                <p
                  className="text-blue-600"
                  style={{ fontSize: `${Math.max(readerFontSize - 3, 12)}px`, lineHeight: 1.75 }}
                >
                  {translations[sentenceKey]}
                </p>
              ) : (
                <button
                  onClick={() => onTranslateSentence(paragraphId, sentence, index)}
                  className="text-xs text-blue-600 underline hover:text-blue-800"
                >
                  Translate
                </button>
              )}
            </div>
          )}
        </div>
      );
    });
  };

  const pageGroups = useMemo<PageGroup[]>(() => {
    const groups = new Map<number, Paragraph[]>();
    for (const p of paragraphs) {
      const page = parsePage(p.location);
      if (!groups.has(page)) groups.set(page, []);
      groups.get(page)!.push(p);
    }
    return Array.from(groups.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([page, items]) => ({ page, items }));
  }, [paragraphs]);

  return (
    <div className="space-y-8">
      {pageGroups.map(({ page, items }) => {
        const nodes = buildFlowNodes(items, matched);
        return (
          <section key={`page-${page}`} className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
            <div className="mb-4 border-b border-slate-100 pb-2 text-xs font-semibold tracking-wide text-slate-500">
              PAGE {page}
            </div>
            <div className="space-y-4">
              {nodes.map((node) => {
                if (node.kind === 'image') {
                  return (
                    <figure key={node.id} className="my-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <img
                        src={convertFileSrc(node.path)}
                        alt={node.caption || 'Extracted figure'}
                        className="mx-auto max-h-[32rem] w-auto max-w-full rounded object-contain"
                      />
                      {node.caption && (
                        <figcaption className="mt-2 text-center text-sm text-slate-600">{node.caption}</figcaption>
                      )}
                    </figure>
                  );
                }

                if (node.kind === 'table') {
                  const rows = parseTableRows(node.text);
                  if (rows) {
                    return (
                      <div key={node.id}>
                        <div className={`overflow-x-auto rounded-lg border p-2 ${node.highlight ? 'border-yellow-300 bg-yellow-50' : 'border-slate-200 bg-slate-50'}`}>
                          <table className="min-w-full border-collapse text-left text-[0.92em] text-slate-800">
                            <tbody>
                              {rows.map((row, rowIdx) => (
                                <tr key={`${node.id}-r-${rowIdx}`} className="border-b border-slate-200 last:border-b-0">
                                  {row.map((cell, cellIdx) => (
                                    <td
                                      key={`${node.id}-c-${rowIdx}-${cellIdx}`}
                                      className={`px-2 py-1.5 align-top ${rowIdx === 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
                                    >
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-2">
                          {renderSentenceRows(node.id, node.text, node.highlight, false, '')}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={node.id}>
                      <div className={`rounded-lg border p-2 ${node.highlight ? 'border-yellow-300 bg-yellow-50' : 'border-slate-200 bg-slate-50'}`}>
                        <pre
                          className="overflow-x-auto whitespace-pre-wrap font-mono text-[0.9em] leading-relaxed text-slate-700"
                          style={{ fontSize: `${Math.max(readerFontSize - 2, 12)}px` }}
                        >
                          {node.text}
                        </pre>
                      </div>
                      <div className="mt-2">
                        {renderSentenceRows(node.id, node.text, node.highlight, false, '')}
                      </div>
                    </div>
                  );
                }

                if (node.kind === 'formula') {
                  return (
                    <div key={node.id}>
                      <div
                        className={`rounded-lg border p-2 ${node.highlight ? 'border-yellow-300 bg-yellow-50' : 'border-indigo-200 bg-indigo-50/40'}`}
                      >
                        <pre
                          className="overflow-x-auto whitespace-pre-wrap font-mono text-[0.9em] leading-relaxed text-slate-700"
                          style={{ fontSize: `${Math.max(readerFontSize - 1, 12)}px` }}
                        >
                          {node.text}
                        </pre>
                      </div>
                      <div className="mt-2">
                        {renderSentenceRows(node.id, node.text, node.highlight, false, '')}
                      </div>
                    </div>
                  );
                }

                if (node.kind === 'page-visual') {
                  const reasonText =
                    node.reason === 'missing-figure'
                      ? '检测到图注但未成功抽取图片，可展开查看原页图表'
                      : node.reason === 'formula-fallback'
                        ? '检测到公式/特殊符号解析异常，可展开查看原页校对'
                        : '检测到表格解析可能异常，可展开查看原页校对';
                  return (
                    <div key={node.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <details>
                        <summary className="cursor-pointer select-none text-xs font-medium text-slate-700">
                          {reasonText}
                        </summary>
                        <iframe
                          title={`PDF page ${page} visual fallback`}
                          src={`${convertFileSrc(pdfPath)}#page=${page}&zoom=page-width&toolbar=0&navpanes=0`}
                          className="mt-2 h-[48vh] w-full rounded"
                        />
                      </details>
                    </div>
                  );
                }

                return (
                  <div key={node.id}>
                    {renderSentenceRows(
                      node.id,
                      node.text,
                      node.highlight,
                      true,
                      `text-slate-800 ${node.highlight ? 'rounded bg-yellow-50 px-2 py-1' : ''}`
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};
