import type { ReactNode } from 'react';

export type ShowToast = (msg: string, kind?: 'success' | 'error') => void;

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  if (!title) {
    return <div className="settings-group">{children}</div>;
  }
  return (
    <section className="settings-group">
      <h3 className="settings-group-title">{title}</h3>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

export interface SettingsRowProps {
  icon?: ReactNode;
  title: ReactNode;
  copy?: ReactNode;
  /**
   * Right-aligned control. Optional — a row that has nothing to place on
   * the right simply omits it; passing a filler <span /> to preserve
   * layout is unnecessary because .settings-row-body already flexes.
   */
  trailing?: ReactNode;
  fullWidth?: boolean;
  children?: ReactNode;
}

export function SettingsRow({ icon, title, copy, trailing, fullWidth, children }: SettingsRowProps) {
  return (
    <div className={`settings-row${fullWidth ? ' is-full-width' : ''}`}>
      {icon ? <div className="settings-row-icon">{icon}</div> : null}
      <div className="settings-row-body">
        <div className="settings-row-title">{title}</div>
        {copy ? <p className="settings-row-copy">{copy}</p> : null}
        {children}
      </div>
      {trailing ? <div className="settings-row-trailing">{trailing}</div> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle${checked ? ' is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

export function Picker({
  value,
  onChange,
  disabled = false,
  children,
}: {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <select
      className="settings-picker"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

const statusPillVariantMap: Record<'good' | 'warn' | 'error' | 'muted' | 'neutral', string> = {
  good: 'is-good',
  warn: 'is-warn',
  error: 'is-warn',
  muted: 'is-neutral',
  neutral: 'is-neutral',
};

export function StatusPill({
  label,
  variant,
}: {
  label: string;
  variant: 'good' | 'warn' | 'error' | 'muted' | 'neutral';
}) {
  return (
    <span className={`settings-state-pill ${statusPillVariantMap[variant]}`}>
      {label}
    </span>
  );
}
