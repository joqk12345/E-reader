import React from 'react';

type ThinkingDisclosureProps = {
  thinkingBlocks: string[];
  summaryLabel?: string;
  className?: string;
};

export const ThinkingDisclosure: React.FC<ThinkingDisclosureProps> = ({
  thinkingBlocks,
  summaryLabel,
  className = '',
}) => {
  if (thinkingBlocks.length === 0) return null;

  const label =
    summaryLabel || `Show model thinking (${thinkingBlocks.length})`;

  return (
    <details className={`rounded-md border border-amber-200 bg-amber-50/70 ${className}`}>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-amber-800">
        {label}
      </summary>
      <div className="space-y-2 border-t border-amber-200 px-3 py-3">
        {thinkingBlocks.map((block, index) => (
          <pre
            key={`${index}-${block.length}`}
            className="whitespace-pre-wrap text-xs leading-6 text-amber-900"
          >
            {block}
          </pre>
        ))}
      </div>
    </details>
  );
};
