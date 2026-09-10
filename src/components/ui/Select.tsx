import type { SelectHTMLAttributes } from 'react';
import { inputClassName } from './Input';

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputClassName} ${className}`} {...props} />;
}
