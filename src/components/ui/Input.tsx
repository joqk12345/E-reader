import type { InputHTMLAttributes } from 'react';

export const inputClassName =
  'h-9 rounded-xl border border-control-border bg-surface px-3 text-size-control text-foreground outline-none transition placeholder:text-muted focus:border-focus-border focus:ring-2 focus:ring-focus/15 disabled:cursor-not-allowed disabled:opacity-50';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClassName} ${className}`} {...props} />;
}
