export type TargetLang = 'zh' | 'en';
export type SentenceSpan = {
  text: string;
  start: number;
  end: number;
};

export const sanitizeText = (text: string): string => {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\uFFFD/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const splitIntoSentences = (text: string): string[] => {
  return splitIntoSentenceSpans(text).map((item) => item.text);
};

export const splitIntoSentenceSpans = (text: string): SentenceSpan[] => {
  const cleaned = sanitizeText(text);
  if (!cleaned) return [];

  const spans: SentenceSpan[] = [];
  const boundary = /(?<=[.!?。！？])\s+/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(cleaned)) !== null) {
    const end = match.index;
    const sentence = cleaned.slice(start, end).trim();
    if (sentence) {
      spans.push({ text: sentence, start, end: start + sentence.length });
    }
    start = match.index + match[0].length;
  }

  const tail = cleaned.slice(start).trim();
  if (tail) {
    spans.push({ text: tail, start, end: start + tail.length });
  }

  return spans.length > 0 ? spans : [{ text: cleaned, start: 0, end: cleaned.length }];
};

export const detectLang = (text: string): TargetLang => {
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  return 'en';
};

export const toSpeakableText = (input: string, options?: { markdown?: boolean }): string => {
  const markdown = options?.markdown ?? false;
  if (!markdown) return sanitizeText(input);
  return sanitizeText(
    input
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/<https?:\/\/[^>\s]+>/gi, ' ')
      .replace(/\bhttps?:\/\/[^\s)\]>]+/gi, ' ')
      .replace(/\bwww\.[^\s)\]>]+/gi, ' ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/[*_~|]/g, ' ')
  );
};

export const parseSentenceKey = (key: string): { paragraphId: string; sentenceIndex: number } | null => {
  const lastUnderscore = key.lastIndexOf('_');
  if (lastUnderscore <= 0 || lastUnderscore >= key.length - 1) return null;
  const paragraphId = key.slice(0, lastUnderscore);
  const sentenceIndex = Number.parseInt(key.slice(lastUnderscore + 1), 10);
  if (!paragraphId || Number.isNaN(sentenceIndex) || sentenceIndex < 0) return null;
  return { paragraphId, sentenceIndex };
};
