import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-action text-on-action hover:bg-action-text',
  secondary: 'border border-control-border bg-surface text-secondary hover:bg-surface-hover',
  ghost: 'text-secondary hover:bg-surface-hover',
  danger: 'bg-danger text-on-action hover:bg-danger',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-lg px-3 text-size-control',
  md: 'h-9 rounded-xl px-4 text-size-control',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 font-medium transition focus:outline-none focus:ring-2 focus:ring-focus/20 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  size = 'sm',
  className = '',
  children,
  ...props
}: Omit<ButtonProps, 'children'> & { label: string; children: ReactNode }) {
  return (
    <Button
      {...props}
      size={size}
      className={`aspect-square !px-0 ${className}`}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

export function PanelButton({ variant = 'ghost', size = 'sm', ...props }: ButtonProps) {
  return <Button variant={variant} size={size} {...props} />;
}
