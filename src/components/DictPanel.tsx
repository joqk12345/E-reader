import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store/useStore';
import { detectLang } from '../utils/sentences';

type DictMode = 'dict' | 'sentence';

type DictRequest = {
  id: number;
  mode: DictMode;
  selectedText: string;
  sentence: string;
  paragraphId?: string;
} | null;

type DictPanelProps = {
  request?: DictRequest;
};

type TtsAudioResponse = {
  audio: number[];
  mime_type: string;
};

type DictResult = {
  headword: string;
  ipa: string;
  meaning: string;
  usage: string;
};

const DEFAULT_DICT: DictResult = {
  headword: '',
  ipa: '',
  meaning: '',
  usage: '',
};

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
const stripFences = (text: string) =>
  text.replace(/^```json\s*/i, '').replace(/^```markdown\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
const extractJsonBlock = (text: string): string | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
};
const normalizeIpa = (value: string) => value.trim().replace(/^\/+|\/+$/g, '');
const treeLineRe = /(~\/|├──|└──|│\s|^\s{2,}\S)/;
const normalizeMarkdownForDisplay = (text: string): string => {
  const source = text.trim();
  if (!source) return source;
  if (source.includes('```')) return source;

  const lines = source.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] || '';
    if (treeLineRe.test(line)) {
      const block: string[] = [];
      while (i < lines.length && (treeLineRe.test(lines[i] || '') || !(lines[i] || '').trim())) {
        block.push(lines[i] || '');
        i += 1;
      }
      out.push('```text');
      out.push(...block);
      out.push('```');
      continue;
    }
    out.push(line);
    i += 1;
  }

  return out.join('\n');
};

export function DictPanel({ request }: DictPanelProps) {
  const { selectedDocumentId, currentSectionId, currentParagraph } = useStore();
  const [mode, setMode] = useState<DictMode>('dict');
  const [selectedText, setSelectedText] = useState('');
  const [sentence, setSentence] = useState('');
  const [dictResult, setDictResult] = useState<DictResult>(DEFAULT_DICT);
  const [sentenceTranslation, setSentenceTranslation] = useState('');
  const [sentenceAnalysis, setSentenceAnalysis] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contextParagraphIdRef = useRef<string | undefined>(undefined);

  const buildContext = (paragraphId?: string) => {
    if (paragraphId) return { paragraphId };
    if (currentParagraph?.id) return { paragraphId: currentParagraph.id };
    if (currentSectionId) return { sectionId: currentSectionId };
    if (selectedDocumentId) return { docId: selectedDocumentId };
    return {};
  };

  const parseDictJson = (raw: string): DictResult => {
    const cleaned = stripFences(stripThinking(raw));
    const jsonCandidate = extractJsonBlock(cleaned);

    if (jsonCandidate) {
      const jsonLike = jsonCandidate
        .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
        .replace(/:\s*\/([^/\n]+)\/(?=\s*[,}])/g, ': "$1"');
      try {
        const parsed = JSON.parse(jsonLike) as Partial<DictResult>;
        return {
          headword: (parsed.headword || selectedText).trim(),
          ipa: normalizeIpa(String(parsed.ipa || '')),
          meaning: String(parsed.meaning || '').trim() || '—',
          usage: String(parsed.usage || '').trim() || '—',
        };
      } catch {
        // Fall through to regex extraction.
      }
    }

    const headwordMatch = cleaned.match(/headword["']?\s*[:：]\s*["'`*]*([^"\n,}*`]+)["'`*]?/i);
    const ipaMatch = cleaned.match(/ipa["']?\s*[:：]\s*["']?([^,"\n}]+)["']?/i);
    const meaningMatch = cleaned.match(/meaning["']?\s*[:：]\s*["']?([\s\S]*?)(?:["']?\s*,\s*["']?usage|$)/i);
    const usageMatch = cleaned.match(/usage["']?\s*[:：]\s*["']?([\s\S]*?)["']?\s*$/i);

    const fallbackMeaning = cleaned.replace(jsonCandidate || '', '').trim();
    return {
      headword: (headwordMatch?.[1] || selectedText).trim(),
      ipa: normalizeIpa(ipaMatch?.[1] || ''),
      meaning: (meaningMatch?.[1] || fallbackMeaning || '—').trim(),
      usage: (usageMatch?.[1] || '—').trim(),
    };
  };

  const runSentenceTranslation = async (sentenceText: string) => {
    if (!sentenceText.trim()) {
      setSentenceTranslation('');
      return;
    }
    const targetLang = detectLang(sentenceText) === 'zh' ? 'en' : 'zh';
    const translated = await invoke<string>('translate', {
      text: sentenceText,
      targetLang,
    });
    setSentenceTranslation(translated);
  };

  const runDictionary = async (text: string, sentenceText: string, paragraphId?: string) => {
    const targetContext = buildContext(paragraphId);
    const question = [
      'You are a dictionary assistant.',
      `Target expression: "${text}"`,
      `Sentence context: "${sentenceText}"`,
      'Return strict JSON only with keys: headword, ipa, meaning, usage.',
      'meaning must be the most suitable meaning in this sentence context, concise Chinese.',
      'ipa should be IPA if available; else empty string.',
      'usage should briefly explain why this meaning fits this sentence.',
    ].join('\n');

    const answer = await invoke<string>('chat_with_context', {
      question,
      docId: targetContext.docId,
      sectionId: targetContext.sectionId,
      paragraphId: targetContext.paragraphId,
      history: [],
    });
    setDictResult(parseDictJson(answer));
  };

  const runSentenceAnalysis = async (sentenceText: string, paragraphId?: string) => {
    const targetContext = buildContext(paragraphId);
    const question = [
      '请做句子成分分析，并输出 markdown。',
      `句子: "${sentenceText}"`,
      '格式要求：',
      '1) 主语：用**粗体**表示',
      '2) 谓语：用==高亮==表示',
      '3) 宾语：用*斜体*表示',
      '4) 定语：用`反引号`表示',
      '5) 状语：用<u>下划线HTML标签</u>表示',
      '6) 补语：用> 引用块表示',
      '然后给出简短中文解释和完整中文翻译。',
      '请只输出 markdown 内容，不要输出多余前言。',
    ].join('\n');

    const answer = await invoke<string>('chat_with_context', {
      question,
      docId: targetContext.docId,
      sectionId: targetContext.sectionId,
      paragraphId: targetContext.paragraphId,
      history: [],
    });
    setSentenceAnalysis(stripThinking(answer));
  };

  const run = async (nextMode: DictMode, text: string, sentenceText: string, paragraphId?: string) => {
    if (!text.trim()) {
      setError('Please select text first.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      if (nextMode === 'dict') {
        await Promise.all([
          runDictionary(text, sentenceText, paragraphId),
          runSentenceTranslation(sentenceText),
        ]);
      } else {
        await Promise.all([
          runSentenceAnalysis(sentenceText, paragraphId),
          runSentenceTranslation(sentenceText),
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Request failed');
    } finally {
      setIsLoading(false);
    }
  };

  const playPronunciation = async () => {
    const text = (dictResult.headword || selectedText).trim();
    if (!text || isPlaying) return;
    setIsPlaying(true);
    try {
      const language = detectLang(text);
      const result = await invoke<TtsAudioResponse>('tts_synthesize', {
        request: {
          text,
          language,
          provider: 'auto',
          rate: 1.0,
        },
      });
      const bytes = new Uint8Array(result.audio);
      const blob = new Blob([bytes], { type: result.mime_type || 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error('Audio playback failed'));
        void audio.play().catch(reject);
      });
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Pronunciation failed');
    } finally {
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    if (!request) return;
    contextParagraphIdRef.current = request.paragraphId;
    setMode(request.mode);
    setSelectedText(request.selectedText || '');
    setSentence(request.sentence || request.selectedText || '');
    setDictResult(DEFAULT_DICT);
    setSentenceAnalysis('');
    setSentenceTranslation('');
    void run(
      request.mode,
      request.selectedText || '',
      request.sentence || request.selectedText || '',
      request.paragraphId
    );
  }, [request?.id]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 p-3">
        <div className="mb-2 flex items-center gap-2">
          <button
            onClick={() => {
              setMode('dict');
              void run('dict', selectedText, sentence, contextParagraphIdRef.current);
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === 'dict' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            Dict
          </button>
          <button
            onClick={() => {
              setMode('sentence');
              void run('sentence', selectedText, sentence, contextParagraphIdRef.current);
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === 'sentence' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            Sentence
          </button>
        </div>
        <div className="space-y-2">
          <input
            value={selectedText}
            onChange={(e) => setSelectedText(e.target.value)}
            placeholder="Selected word or phrase"
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          />
          <textarea
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            placeholder="Sentence context"
            rows={3}
            className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          />
          <button
            onClick={() => void run(mode, selectedText, sentence, contextParagraphIdRef.current)}
            disabled={isLoading}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Running...' : 'Run'}
          </button>
        </div>
      </div>

      {error && <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

      <div className="flex-1 overflow-y-auto p-3">
        {mode === 'dict' ? (
          <div className="space-y-3">
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-base font-semibold text-gray-800">{dictResult.headword || selectedText || '—'}</h3>
                <button
                  onClick={() => void playPronunciation()}
                  disabled={isPlaying || !(dictResult.headword || selectedText)}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {isPlaying ? 'Playing...' : '🔊'}
                </button>
              </div>
              <p className="text-sm text-gray-600">IPA: {dictResult.ipa || 'N/A'}</p>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <h4 className="mb-1 text-sm font-semibold text-gray-800">Most Suitable Meaning</h4>
              <div className="prose prose-sm max-w-none break-words text-gray-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {normalizeMarkdownForDisplay(dictResult.meaning || '—')}
                </ReactMarkdown>
              </div>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <h4 className="mb-1 text-sm font-semibold text-gray-800">Why This Meaning</h4>
              <div className="prose prose-sm max-w-none break-words text-gray-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {normalizeMarkdownForDisplay(dictResult.usage || '—')}
                </ReactMarkdown>
              </div>
            </div>
            <div className="rounded border border-gray-200 p-3">
              <h4 className="mb-1 text-sm font-semibold text-gray-800">Sentence Translation</h4>
              <div className="prose prose-sm max-w-none break-words text-gray-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {normalizeMarkdownForDisplay(sentenceTranslation || '—')}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border border-gray-200 p-3">
              <h4 className="mb-2 text-sm font-semibold text-gray-800">Sentence Analysis</h4>
              {sentenceAnalysis ? (
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => (
                        <p className="whitespace-pre-wrap break-words leading-relaxed">{children}</p>
                      ),
                      li: ({ children }) => (
                        <li className="whitespace-pre-wrap break-words leading-relaxed">{children}</li>
                      ),
                      blockquote: ({ children }) => (
                        <blockquote className="whitespace-pre-wrap break-words">{children}</blockquote>
                      ),
                      code: ({ children }) => (
                        <code className="whitespace-pre-wrap break-words">{children}</code>
                      ),
                    }}
                  >
                    {normalizeMarkdownForDisplay(sentenceAnalysis)}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No analysis yet.</p>
              )}
            </div>
            <div className="rounded border border-gray-200 p-3">
              <h4 className="mb-1 text-sm font-semibold text-gray-800">Sentence Translation</h4>
              <div className="prose prose-sm max-w-none break-words text-gray-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {normalizeMarkdownForDisplay(sentenceTranslation || '—')}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
