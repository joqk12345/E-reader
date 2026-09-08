import type { InputHTMLAttributes } from 'react';

export function Range({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="range"
      className={`h-1.5 w-full cursor-pointer accent-action ${className}`}
      {...props}
    />
  );
}
