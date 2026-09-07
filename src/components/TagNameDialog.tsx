import React from 'react';
import { Button } from './ui/Button';

type TagNameDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  value: string;
  confirmLabel?: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export const TagNameDialog: React.FC<TagNameDialogProps> = ({
  open,
  title,
  description,
  value,
  confirmLabel = 'Create',
  onChange,
  onClose,
  onConfirm,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
        <h3 className="text-base font-semibold text-heading">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}

        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onConfirm();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Tag name"
          className="mt-4 h-10 w-full rounded-md border border-control-border px-3 text-sm focus:border-focus focus:outline-none"
        />

        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={onConfirm} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
