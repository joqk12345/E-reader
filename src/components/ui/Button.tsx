import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'ui-button-primary',
  secondary: 'ui-button-secondary',
  ghost: 'ui-button-ghost',
  danger: 'ui-button-danger',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'ui-button-sm',
  md: 'ui-button-md',
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
      className={`ui-button ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
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
