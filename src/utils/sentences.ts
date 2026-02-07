export type TargetLang = 'zh' | 'en';

export const splitIntoSentences = (text: string): string[] => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
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
