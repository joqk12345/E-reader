import type { InputHTMLAttributes } from 'react';

export function Checkbox({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 rounded border-control-border accent-action focus:ring-2 focus:ring-focus/20 ${className}`}
      {...props}
    />
  );
}
