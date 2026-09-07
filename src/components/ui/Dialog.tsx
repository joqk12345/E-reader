import type { ReactNode } from 'react';

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  labelledBy,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  labelledBy?: string;
}) {
  if (!open) return null;
  const titleId = labelledBy || 'reader-dialog-title';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-panel border border-border bg-surface p-5 shadow-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="font-serif text-[21px] font-medium tracking-tight text-heading">{title}</h3>
        {description && <p className="mt-1 text-control leading-5 text-muted">{description}</p>}
        {children}
      </div>
    </div>
  );
}
