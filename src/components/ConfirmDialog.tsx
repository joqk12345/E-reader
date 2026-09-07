import React from 'react';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

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
    <Dialog open={open} title={title} description={description} onClose={onClose}>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button size="sm" variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
    </Dialog>
  );
};
