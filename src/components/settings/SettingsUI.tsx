import type { ReactNode } from 'react';

export const compactControlClass =
  'h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400';

export function StatusDot({ success, text }: { success: boolean; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] ${success ? 'text-emerald-600' : 'text-slate-500'}`}>
      <span className={`h-2 w-2 rounded-full ${success ? 'bg-emerald-500' : 'bg-slate-300'}`} />
      {text}
    </span>
  );
}

export function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition ${
        checked ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-slate-200'
      } ${disabled ? 'cursor-not-allowed opacity-50 saturate-0' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm">{children}</div>;
}

export function SettingsDivider() {
  return <div className="my-1 border-t border-slate-200" />;
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
    <div className={`grid grid-cols-[minmax(0,1fr)_280px] items-center gap-4 py-2 ${disabled ? 'opacity-55 saturate-0' : ''}`}>
      <div>
        <p className="text-[15px] font-semibold text-slate-900">{title}</p>
        {description ? <p className="mt-0.5 text-[12px] text-slate-500">{description}</p> : null}
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
        active ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-200/70'
      }`}
    >
      <span className={active ? 'text-blue-600' : 'text-slate-500'}>{icon}</span>
      <span className="text-[12px] font-medium">{label}</span>
    </button>
  );
}

export function KVInfo({
  rows,
}: {
  rows: Array<{ key: string; value: ReactNode }>;
}) {
  return (
    <div className="space-y-1.5 text-[13px]">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-4">
          <span className="text-slate-400">{row.key}</span>
          <span className="text-right text-slate-700">{row.value}</span>
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
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-[13px] text-slate-700 shadow-sm hover:bg-slate-200"
    >
      {icon}
      {label}
    </button>
  );
}
