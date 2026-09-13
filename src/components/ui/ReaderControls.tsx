import type { ChangeEvent, SelectHTMLAttributes, InputHTMLAttributes } from 'react';

type ReaderSelectProps = SelectHTMLAttributes<HTMLSelectElement>;
type ReaderRangeProps = InputHTMLAttributes<HTMLInputElement>;

const controlClassName = 'rounded-md border border-control-border bg-surface px-2 py-1 text-foreground';

export function ReaderSelect(props: ReaderSelectProps) {
  return <select {...props} className={`${controlClassName} ${props.className || ''}`} />;
}

export function ReaderRange(props: ReaderRangeProps) {
  return <input {...props} className={`accent-action ${props.className || ''}`} />;
}

export type ReaderControlChange = ChangeEvent<HTMLSelectElement | HTMLInputElement>;
