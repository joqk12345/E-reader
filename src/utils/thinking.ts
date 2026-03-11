export type ThinkingParseResult = {
  visibleText: string;
  thinkingBlocks: string[];
};

export const parseThinkingBlocks = (input: string): ThinkingParseResult => {
  if (!input) {
    return {
      visibleText: '',
      thinkingBlocks: [],
    };
  }

  const thinkingBlocks: string[] = [];
  const visibleText = input
    .replace(/<think>([\s\S]*?)<\/think>/gi, (_, content: string) => {
      const normalized = content.trim();
      if (normalized) {
        thinkingBlocks.push(normalized);
      }
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    visibleText,
    thinkingBlocks,
  };
};
