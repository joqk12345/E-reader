import type { TextareaHTMLAttributes } from 'react';

export const textareaClassName =
  'rounded-xl border border-control-border bg-surface px-3 py-2 text-size-control text-foreground outline-none transition placeholder:text-muted focus:border-focus-border focus:ring-2 focus:ring-focus/15 disabled:cursor-not-allowed disabled:opacity-50';

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${textareaClassName} ${className}`} {...props} />;
}
