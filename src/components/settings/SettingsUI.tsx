import type { ReactNode } from 'react';

export const compactControlClass =
  'h-9 rounded-xl border border-control-border bg-surface px-3 text-control text-foreground outline-none transition focus:border-focus-border focus:ring-2 focus:ring-focus/15';

export function StatusDot({ success, text }: { success: boolean; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-caption ${success ? 'text-success' : 'text-muted'}`}>
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
        <p className="text-label font-semibold text-heading">{title}</p>
        {description ? <p className="mt-0.5 text-caption text-muted">{description}</p> : null}
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
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left transition ${
        active ? 'bg-action-subtle text-action-text' : 'text-navigation hover:bg-surface-hover/70'
      }`}
    >
      <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center ${active ? 'text-action' : 'text-muted'}`}>{icon}</span>
      <span className="text-caption font-medium">{label}</span>
    </button>
  );
}

export function KVInfo({
  rows,
}: {
  rows: Array<{ key: string; value: ReactNode }>;
}) {
  return (
    <div className="space-y-1.5 text-control">
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
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-control-border bg-surface-subtle px-2.5 py-1.5 text-control text-secondary shadow-sm hover:bg-surface-hover"
    >
      {icon}
      {label}
    </button>
  );
}
