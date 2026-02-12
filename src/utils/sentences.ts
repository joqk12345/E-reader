export type TargetLang = 'zh' | 'en';

export const sanitizeText = (text: string): string => {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\uFFFD/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const splitIntoSentences = (text: string): string[] => {
  const cleaned = sanitizeText(text);
  if (!cleaned) return [];
  const list = cleaned
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [cleaned];
};

export const detectLang = (text: string): TargetLang => {
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  return 'en';
};
