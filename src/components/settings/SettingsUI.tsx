import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { inputClassName } from '../ui/Input';

export const compactControlClass = inputClassName;

export function StatusDot({ success, text }: { success: boolean; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-size-caption ${success ? 'text-success' : 'text-muted'}`}>
      <span className={`h-2 w-2 rounded-full ${success ? 'bg-success-indicator' : 'bg-control-border'}`} />
      {text}
    </span>
  );
}

export { ToggleSwitch } from '../ui/Switch';

export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-border bg-surface px-5 py-3">{children}</div>;
}

export function SettingsDivider() {
  return <div className="my-1 border-t border-border" />;
}

export function SettingRow({
  title,
  description,
  right,
  disabled,
}: {
  title: string;
  description?: string;
  right: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`grid grid-cols-setting-row items-center gap-6 py-3 ${disabled ? 'opacity-55 saturate-0' : ''}`}>
      <div>
        <p className="text-size-label font-semibold text-heading">{title}</p>
        {description ? <p className="mt-0.5 text-size-caption text-muted">{description}</p> : null}
      </div>
      <div className="flex items-center justify-end gap-2.5">{right}</div>
    </div>
  );
}

export function SidebarNavItem({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`h-auto justify-start rounded-full px-3 py-2 text-left text-size-caption ${
        active ? 'bg-action-subtle text-action-text' : 'text-navigation hover:bg-surface-hover/70'
      }`}
    >
      <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center ${active ? 'text-action' : 'text-muted'}`}>{icon}</span>
      <span className="font-medium">{label}</span>
    </Button>
  );
}

export function KVInfo({
  rows,
}: {
  rows: Array<{ key: string; value: ReactNode }>;
}) {
  return (
    <div className="space-y-1.5 text-size-control">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-4">
          <span className="text-faint">{row.key}</span>
          <span className="text-right text-secondary">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function SecondaryActionButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return <Button size="sm" icon={icon} onClick={onClick}>{label}</Button>;
}
