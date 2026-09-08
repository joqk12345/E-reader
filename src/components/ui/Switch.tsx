export function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition ${
        checked ? 'border-action bg-action' : 'border-control-border bg-surface-hover'
      } ${disabled ? 'cursor-not-allowed opacity-50 saturate-0' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 h-switch-thumb w-switch-thumb rounded-full bg-on-action shadow transition-transform ${
          checked ? 'translate-x-switch-travel' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
