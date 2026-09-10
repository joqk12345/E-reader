import React from 'react';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Input } from './ui/Input';

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
    <Dialog open={open} title={title} description={description} onClose={onClose}>
        <Input
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
          className="mt-5 h-10 w-full"
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={onConfirm} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </div>
    </Dialog>
  );
};
