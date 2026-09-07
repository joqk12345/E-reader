import type { ReactNode } from 'react';

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-surface-subtle p-1" role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={`rounded-full px-3 py-1.5 text-control font-medium transition ${value === item.value ? 'bg-surface text-heading shadow-sm' : 'text-navigation hover:text-heading'}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
