import React from 'react';
import { Button } from './ui/Button';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onClose: () => void;
  onConfirm: () => void;
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onClose,
  onConfirm,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
        <h3 className="text-base font-semibold text-heading">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button size="sm" variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
