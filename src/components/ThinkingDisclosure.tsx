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
    <details className={`rounded-md border border-warning/25 bg-warning-subtle/70 ${className}`}>
      <summary className="cursor-pointer select-none px-3 py-2 text-size-caption font-medium text-warning">
        {label}
      </summary>
      <div className="space-y-2 border-t border-warning/25 px-3 py-3">
        {thinkingBlocks.map((block, index) => (
          <pre
            key={`${index}-${block.length}`}
            className="whitespace-pre-wrap text-size-caption leading-6 text-warning"
          >
            {block}
          </pre>
        ))}
      </div>
    </details>
  );
};
