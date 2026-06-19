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
  trailing?: ReactNode;
  fullWidth?: boolean;
  children?: ReactNode;
}

export function SettingsRow({ icon, title, copy, trailing, fullWidth, children }: SettingsRowProps) {
  return (
    <div className={`settings-row${fullWidth ? ' is-fullwidth' : ''}`}>
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
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
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

export function StatusPill({
  label,
  variant,
}: {
  label: string;
  variant: 'good' | 'warn' | 'error' | 'muted' | 'neutral';
}) {
  return <span className={`status-pill status-pill-${variant}`}>{label}</span>;
}
