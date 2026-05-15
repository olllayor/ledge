import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState, ShelfRecord } from '@shared/schema';
import { normalizeExcludedBundleIds } from '@shared/preferences';
import { estimateImportedImageStorageBytes, syncShelfLimitForPlan } from '@shared/sync';
import { useSync } from '../providers/SyncProvider';
import { IconArrowUpRight, IconChevronDown, IconGear } from './Icons';
import { IconApp, IconCloud, IconFolderOpen, IconSparkles, IconStar, IconWrench, IconZap } from './PreferencesIcons';

interface PreferencesViewProps {
  state: AppState;
}

const sidebarItems: { label: string; icon: ReactNode }[] = [
  { label: 'Shelf Activation', icon: <IconArrowUpRight /> },
  { label: 'Shelf Interaction', icon: <IconSparkles /> },
  { label: 'General', icon: <IconGear /> },
  { label: 'Cloud Sharing', icon: <IconCloud /> },
  { label: 'Custom Actions', icon: <IconWrench /> },
  { label: 'Instant Actions', icon: <IconZap /> },
  { label: 'Folder Monitoring', icon: <IconFolderOpen /> },
  { label: 'Ledge Pro', icon: <IconStar /> },
];

export function PreferencesView({ state }: PreferencesViewProps) {
  const preferences = state.preferences;
  const [excludedText, setExcludedText] = useState(preferences.excludedBundleIds.join('\n'));
  const [excludedError, setExcludedError] = useState('');
  const [shortcutDraft, setShortcutDraft] = useState(preferences.globalShortcut);
  const [activeSection, setActiveSection] = useState('General');
  const appVersion = '0.1.0';

  useEffect(() => {
    setExcludedText(preferences.excludedBundleIds.join('\n'));
    setExcludedError('');
  }, [preferences.excludedBundleIds]);

  useEffect(() => {
    setShortcutDraft(preferences.globalShortcut);
  }, [preferences.globalShortcut]);

  const shortcutStatus = !preferences.globalShortcut
    ? 'Shortcut disabled'
    : state.permissionStatus.shortcutRegistered
      ? 'Shortcut active'
      : 'Shortcut unavailable';

  async function saveExcludedApps() {
    const { normalized, invalid } = normalizeExcludedBundleIds(excludedText.split('\n'));
    if (invalid.length > 0) {
      setExcludedError(
        invalid.length === 1
          ? `Invalid bundle identifier: ${invalid[0]}`
          : `Invalid bundle identifiers: ${invalid.join(', ')}`,
      );
      return;
    }

    setExcludedError('');
    setExcludedText(normalized.join('\n'));

    try {
      await window.ledge.setPreferences({
        excludedBundleIds: normalized,
      });
    } catch (error) {
      setExcludedError(error instanceof Error ? error.message : 'Failed to save excluded apps.');
    }
  }

  return (
    <main className="preferences-shell">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-head">
          <p className="eyebrow">Settings</p>
        </div>

        <nav className="settings-nav" aria-label="Preference groups">
          {sidebarItems.map(({ label, icon }) => (
            <button
              key={label}
              className={`settings-nav-item ${label === activeSection ? 'is-active' : 'is-idle'}`}
              type="button"
              aria-current={label === activeSection ? 'page' : undefined}
              onClick={() => setActiveSection(label)}
            >
              <span className="settings-nav-icon">{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-sidebar-foot">
          <div className="settings-app-mark">
            <IconApp />
          </div>
          <p>Ledge {appVersion}</p>
        </div>
      </aside>

      <section className="settings-stage">
        <header className="settings-stage-head">
          <h1>{activeSection}</h1>
        </header>

        {activeSection === 'Cloud Sharing' ? <CloudSyncSettings state={state} /> : null}
        {activeSection === 'Ledge Pro' ? <ProSettings state={state} /> : null}
        {activeSection !== 'General' && activeSection !== 'Cloud Sharing' && activeSection !== 'Ledge Pro' ? (
          <div className="settings-stack">
            <section className="settings-group">
              <SettingsLine title="Coming later" copy="This area is planned for a future paid upgrade." trailing={<span />} />
            </section>
          </div>
        ) : null}
        {activeSection === 'General' ? (
        <div className="settings-stack">
          <section className="settings-group">
            <SettingsLine title="Show in menu bar" trailing={<Toggle checked={true} onChange={() => {}} disabled />} />
            <SettingsLine
              title="Menu bar icon"
              trailing={
                <button className="settings-picker" type="button" disabled>
                  <span>Traditional</span>
                  <span className="settings-picker-caret">
                    <IconChevronDown />
                  </span>
                </button>
              }
            />
          </section>

          <section className="settings-group">
            <SettingsLine
              title="Launch at login"
              trailing={
                <Toggle
                  checked={preferences.launchAtLogin}
                  onChange={(checked) => void window.ledge.setPreferences({ launchAtLogin: checked })}
                />
              }
            />
            <SettingsLine title="Show in Dock" trailing={<Toggle checked={false} onChange={() => {}} disabled />} />
          </section>

          <section className="settings-group">
            <SettingsLine
              title="Application data"
              trailing={
                <button className="settings-cta" disabled>
                  Manage…
                </button>
              }
            />
            <SettingsLine
              title="Disable online features"
              trailing={<Toggle checked={false} onChange={() => {}} disabled />}
            />
          </section>

          <section className="settings-group">
            <SettingsLine
              title="Third party extensions"
              trailing={
                <div className="settings-actions">
                  <button className="settings-cta" disabled>
                    Install Alfred Workflow
                  </button>
                  <button className="settings-cta" disabled>
                    Install Raycast Extension
                  </button>
                </div>
              }
            />
          </section>

          <section className="settings-group">
            <div className="settings-row settings-row-stack">
              <div>
                <p className="settings-row-title">Shelf activation</p>
                <p className="settings-row-copy">
                  Configure the shortcut and shake gesture used to reveal the floating shelf.
                </p>
              </div>
            </div>

            <div className="settings-field">
              <label className="pref-label" htmlFor="shortcut-input">
                Global shortcut
              </label>
              <input
                id="shortcut-input"
                className="pref-input"
                value={shortcutDraft}
                onChange={(event) => setShortcutDraft(event.target.value)}
                onBlur={() => void window.ledge.setPreferences({ globalShortcut: shortcutDraft })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
              <p className={`pref-status ${state.permissionStatus.shortcutError ? 'is-error' : ''}`}>
                {state.permissionStatus.shortcutError || shortcutStatus}
              </p>
            </div>

            <SettingsLine
              title="Shake gesture"
              copy="Reveal the shelf with a cursor shake while dragging."
              trailing={
                <Toggle
                  checked={preferences.shakeEnabled}
                  onChange={(checked) => void window.ledge.setPreferences({ shakeEnabled: checked })}
                />
              }
            />

            <div className="settings-field">
              <label className="pref-label" htmlFor="sensitivity">
                Shake sensitivity
              </label>
              <select
                id="sensitivity"
                className="pref-input"
                value={preferences.shakeSensitivity}
                onChange={(event) =>
                  void window.ledge.setPreferences({
                    shakeSensitivity: event.target.value as AppState['preferences']['shakeSensitivity'],
                  })
                }
              >
                <option value="gentle">Gentle</option>
                <option value="balanced">Balanced</option>
                <option value="firm">Firm</option>
              </select>
            </div>

            <div className="settings-field">
              <label className="pref-label" htmlFor="excluded-apps">
                Excluded apps
              </label>
              <textarea
                id="excluded-apps"
                className="pref-textarea"
                value={excludedText}
                onChange={(event) => {
                  setExcludedText(event.target.value);
                  if (excludedError) {
                    setExcludedError('');
                  }
                }}
                onBlur={() => void saveExcludedApps()}
                placeholder={'com.apple.finder\ncom.apple.FinalCut'}
              />
              <p className="pref-help">One macOS bundle identifier per line.</p>
              {excludedError ? <p className="pref-status is-error">{excludedError}</p> : null}
            </div>
          </section>

          <section className="settings-group">
            <SettingsLine
              title="Native helper"
              copy={state.permissionStatus.nativeHelperAvailable ? 'Connected and ready.' : 'Unavailable right now.'}
              trailing={
                <span
                  className={`settings-state-pill ${state.permissionStatus.nativeHelperAvailable ? 'is-good' : 'is-warn'}`}
                >
                  {state.permissionStatus.nativeHelperAvailable ? 'Online' : 'Missing'}
                </span>
              }
            />

            <SettingsLine
              title="Accessibility"
              copy={
                state.permissionStatus.accessibilityTrusted
                  ? 'Granted for shake detection.'
                  : 'Required if you want shake-to-open.'
              }
              trailing={
                <button className="settings-cta" onClick={() => void window.ledge.openPermissionSettings()}>
                  Open Settings…
                </button>
              }
            />

            <div className="settings-meta">
              <span>
                Shake status:{' '}
                {preferences.shakeEnabled ? (state.permissionStatus.shakeReady ? 'ready' : 'blocked') : 'disabled'}
              </span>
              <span>{state.preferences.excludedBundleIds.length} excluded apps</span>
            </div>
            {state.permissionStatus.lastError ? (
              <p className="pref-status is-error">{state.permissionStatus.lastError}</p>
            ) : null}
          </section>
        </div>
        ) : null}
      </section>
    </main>
  );
}

function CloudSyncSettings({ state }: PreferencesViewProps) {
  const sync = useSync();
  const [email, setEmail] = useState(state.sync.signedInEmail ?? sync.email);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'verifying' | 'signed-in'>('idle');
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [candidates, setCandidates] = useState<ShelfRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const codeInputRef = useRef<HTMLInputElement>(null);
  const limit = sync.overview?.shelfLimit ?? syncShelfLimitForPlan(state.sync.plan);
  const selectedShelves = candidates.filter((shelf) => selectedIds.has(shelf.id));
  const selectedStorageBytes = estimateImportedImageStorageBytes(selectedShelves);
  const isLoggedIn = !!state.sync.signedInEmail;
  const emailError = email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? 'Enter a valid email address.' : '';

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  useEffect(() => {
    if (status === 'sent' && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [status]);

  async function requestCode() {
    if (emailError) return;
    setError('');
    setStatus('sending');
    try {
      await sync.requestOtp(email);
      setStatus('sent');
      setResendCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code.');
      setStatus('idle');
    }
  }

  async function verifyCode() {
    if (code.length < 6) return;
    setError('');
    setStatus('verifying');
    try {
      await sync.verifyOtp(email, code);
      setCode('');
      setStatus('signed-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code.');
      setStatus('sent');
    }
  }

  function handleCodeChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) {
      void verifyCode();
    }
  }

  async function loadCandidates() {
    const shelves = await sync.loadBackfillCandidates();
    setCandidates(shelves);
    setSelectedIds(new Set(shelves.slice(0, limit).map((shelf) => shelf.id)));
  }

  async function syncSelected() {
    setStatus('verifying');
    await sync.syncSelectedShelves([...selectedIds]);
    setStatus('signed-in');
  }

  async function handleSignOut() {
    await sync.signOut();
    setStatus('idle');
    setEmail(state.sync.signedInEmail ?? '');
  }

  if (isLoggedIn) {
    return (
      <div className="settings-stack">
        <section className="settings-group">
          <SettingsLine
            title="Cloud sync"
            copy="Local shelves stay unlimited. Cloud sync is limited by your plan."
            trailing={<span className="settings-state-pill is-good">Connected</span>}
          />
          <SettingsLine title="Signed in as" copy={state.sync.signedInEmail} trailing={<span />} />
          <SettingsLine title="Plan" copy={`${state.sync.plan.toUpperCase()} · ${state.sync.syncedShelfCount}/${limit} synced shelves`} trailing={<span />} />
          <SettingsLine title="Devices" copy={`${state.sync.deviceCount} connected`} trailing={<span />} />
        </section>

        <section className="settings-group">
          <button className="settings-cta is-danger" type="button" onClick={() => void handleSignOut()}>
            Sign Out
          </button>
        </section>

        <section className="settings-group">
          <SettingsLine
            title="Initial backfill"
            copy={`${selectedIds.size}/${limit} selected · approx. ${formatBytes(selectedStorageBytes)} imported images`}
            trailing={
              <button className="settings-cta" type="button" disabled={!sync.sessionToken} onClick={() => void loadCandidates()}>
                Choose…
              </button>
            }
          />
          {candidates.length > 0 ? (
            <div className="sync-candidate-list">
              {candidates.map((shelf) => {
                const checked = selectedIds.has(shelf.id);
                return (
                  <label key={shelf.id} className="sync-candidate">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && selectedIds.size >= limit}
                      onChange={(event) => {
                        const next = new Set(selectedIds);
                        if (event.target.checked) next.add(shelf.id);
                        else next.delete(shelf.id);
                        setSelectedIds(next);
                      }}
                    />
                    <span>{shelf.name}</span>
                    <small>{shelf.items.length} items</small>
                  </label>
                );
              })}
            </div>
          ) : null}
          <button className="settings-cta" type="button" disabled={!sync.sessionToken || selectedIds.size === 0} onClick={() => void syncSelected()}>
            Sync Selected
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-stack">
      <section className="settings-group">
        <SettingsLine
          title="Cloud sync"
          copy={
            sync.configured
              ? 'Sign in to sync your shelves across devices.'
              : 'Set VITE_CONVEX_URL to enable the Convex sync client.'
          }
          trailing={<span className="settings-state-pill">{state.sync.status}</span>}
        />
      </section>

      <section className="settings-group">
        <div className="settings-field">
          <label className="pref-label" htmlFor="sync-email">Email</label>
          <input
            id="sync-email"
            className="pref-input"
            type="email"
            value={email}
            onChange={(event) => { setEmail(event.target.value); setError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter' && !emailError) void requestCode(); }}
            placeholder="you@example.com"
            disabled={status === 'sending'}
          />
          {emailError ? <p className="pref-status is-error">{emailError}</p> : null}
        </div>

        <button
          className="settings-cta"
          type="button"
          disabled={!sync.configured || !email || !!emailError || status === 'sending'}
          onClick={() => void requestCode()}
        >
          {status === 'sending' ? 'Sending…' : 'Send Code'}
        </button>
      </section>

      {status === 'sent' || status === 'verifying' ? (
        <section className="settings-group">
          <div className="settings-field">
            <label className="pref-label" htmlFor="sync-code">Verification code</label>
            <input
              ref={codeInputRef}
              id="sync-code"
              className="pref-input code-input"
              value={code}
              onChange={(event) => handleCodeChange(event.target.value)}
              placeholder="123456"
              inputMode="numeric"
              maxLength={6}
              disabled={status === 'verifying'}
            />
            <p className="pref-help">Check your email for a 6-digit code.</p>
          </div>

          <div className="settings-actions-row">
            <button
              className="settings-cta"
              type="button"
              disabled={!sync.configured || code.length < 6 || status === 'verifying'}
              onClick={() => void verifyCode()}
            >
              {status === 'verifying' ? 'Signing in…' : 'Sign In'}
            </button>
          </div>

          <button
            className="settings-link-btn"
            type="button"
            disabled={resendCooldown > 0}
            onClick={() => void requestCode()}
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
          </button>
        </section>
      ) : null}

      {error ? <p className="pref-status is-error">{error}</p> : null}
    </div>
  );
}

function ProSettings({ state }: PreferencesViewProps) {
  const sync = useSync();
  const [licenseKey, setLicenseKey] = useState('');
  const [orderId, setOrderId] = useState('');
  const [status, setStatus] = useState('');

  async function refresh() {
    setStatus('Refreshing entitlement…');
    await sync.refreshEntitlements({
      licenseKey: licenseKey || undefined,
      orderId: orderId || undefined,
    });
    setStatus('Entitlement refreshed.');
  }

  return (
    <div className="settings-stack">
      <section className="settings-group">
        <SettingsLine title="Ledge Pro" copy="99,000 UZS/year or $9.99/year." trailing={<span className="settings-state-pill">{state.sync.plan}</span>} />
        <SettingsLine title="Cloud limits" copy="3 devices, 500 synced shelves, and 1 GB imported image storage." trailing={<span />} />
        <button className="settings-cta" type="button" onClick={() => window.open('https://ledge.app/pro', '_blank')}>
          Open Checkout
        </button>
      </section>
      <section className="settings-group">
        <div className="settings-field">
          <label className="pref-label" htmlFor="license-key">License key</label>
          <input id="license-key" className="pref-input" value={licenseKey} onChange={(event) => setLicenseKey(event.target.value)} />
        </div>
        <div className="settings-field">
          <label className="pref-label" htmlFor="order-id">Order ID</label>
          <input id="order-id" className="pref-input" value={orderId} onChange={(event) => setOrderId(event.target.value)} />
        </div>
        <button className="settings-cta" type="button" disabled={!sync.sessionToken || (!licenseKey && !orderId)} onClick={() => void refresh()}>
          Refresh Entitlements
        </button>
        {status ? <p className="pref-status">{status}</p> : null}
      </section>
    </div>
  );
}

/* ── Components ── */

interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
}

function Toggle({ checked, onChange, disabled = false }: ToggleProps) {
  return (
    <button
      className={`toggle ${checked ? 'is-on' : ''}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      type="button"
    >
      <span />
    </button>
  );
}

interface SettingsLineProps {
  title: string;
  copy?: string;
  trailing: ReactNode;
}

function SettingsLine({ title, copy, trailing }: SettingsLineProps) {
  return (
    <div className="settings-row">
      <div className="settings-row-main">
        <div>
          <p className="settings-row-title">{title}</p>
          {copy ? <p className="settings-row-copy">{copy}</p> : null}
        </div>
      </div>
      {trailing}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
