import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState, ShakeSensitivity } from '@shared/schema';
import { useSync } from '../providers/SyncProvider';
import { usePlan } from '../hooks/usePlan';
import { IconGear } from './Icons';
import {
  IconApp,
  IconBolt,
  IconCheck,
  IconCloud,
  IconHand,
  IconInfo,
  IconKeyboard,
  IconLock,
  IconMonitor,
  IconShield,
  IconShake,
  IconSparkles,
  IconStar,
} from './PreferencesIcons';
import { ProBadge, ProUpgradePrompt } from './ProUpgradePrompt';

interface PreferencesViewProps {
  state: AppState;
}

interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', icon: <IconGear /> },
  { id: 'shelf', label: 'Shelf', icon: <IconSparkles /> },
  { id: 'activation', label: 'Activation', icon: <IconBolt /> },
  { id: 'cloud', label: 'Cloud Sync', icon: <IconCloud /> },
  { id: 'pro', label: 'Ledge Pro', icon: <IconStar /> },
  { id: 'about', label: 'About', icon: <IconInfo /> },
];

export function PreferencesView({ state }: PreferencesViewProps) {
  const [activeSection, setActiveSection] = useState('general');
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, kind });
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const sectionTitles: Record<string, { title: string; subtitle: string }> = {
    general: { title: 'General', subtitle: 'Appearance, startup, and app behavior.' },
    shelf: { title: 'Shelf', subtitle: 'Configure how shelves behave when you interact with them.' },
    activation: { title: 'Activation', subtitle: 'Choose how to open shelves — shake, shortcut, or tray.' },
    cloud: { title: 'Cloud Sync', subtitle: 'Sync your shelves across devices.' },
    pro: { title: 'Ledge Pro', subtitle: 'Upgrade for higher limits and cloud image storage.' },
    about: { title: 'About Ledge', subtitle: 'Version, links, and acknowledgments.' },
  };

  const header = sectionTitles[activeSection] ?? sectionTitles.general;

  return (
    <main className="preferences-shell">
      <aside className="settings-sidebar">
        <p className="settings-sidebar-label">Settings</p>
        <nav className="settings-nav" aria-label="Preference groups">
          {NAV_ITEMS.map(({ id, label, icon }) => (
            <button
              key={id}
              className={`settings-nav-item ${id === activeSection ? 'is-active' : ''}`}
              type="button"
              aria-current={id === activeSection ? 'page' : undefined}
              title={label}
              onClick={() => setActiveSection(id)}
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
          <p>Ledge 0.1.9</p>
        </div>
      </aside>

      <section className="settings-stage">
        <header className="settings-stage-head">
          <h1>{header.title}</h1>
          <p className="settings-stage-subtitle">{header.subtitle}</p>
        </header>

        <div className="settings-groups">
          {activeSection === 'general' && <GeneralSettings state={state} showToast={showToast} />}
          {activeSection === 'shelf' && <ShelfSettings state={state} showToast={showToast} />}
          {activeSection === 'activation' && <ActivationSettings state={state} showToast={showToast} />}
          {activeSection === 'cloud' && <CloudSyncSettings state={state} showToast={showToast} />}
          {activeSection === 'pro' && <ProSettings state={state} showToast={showToast} />}
          {activeSection === 'about' && <AboutSettings />}
        </div>
      </section>

      {toast && (
        <div className={`pref-toast is-${toast.kind}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      )}
    </main>
  );
}

/* ── General ── */

function GeneralSettings({ state, showToast }: { state: AppState; showToast(msg: string, kind?: 'success' | 'error'): void }) {
  const preferences = state.preferences;
  const [excludedDraft, setExcludedDraft] = useState(preferences.excludedBundleIds.join('\n'));
  const [excludedError, setExcludedError] = useState('');

  useEffect(() => {
    setExcludedDraft(preferences.excludedBundleIds.join('\n'));
  }, [preferences.excludedBundleIds]);

  async function saveExcluded() {
    setExcludedError('');
    const raw = excludedDraft
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await window.ledge.setPreferences({ excludedBundleIds: raw });
      showToast('Excluded applications updated');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update excluded applications';
      setExcludedError(message);
      showToast(message, 'error');
    }
  }

  return (
    <>
      <SettingsGroup title="Appearance">
        <SettingsRow
          icon={<IconMonitor />}
          title="Show in menu bar"
          copy="Ledge stays available from the menu bar."
          trailing={
            <Toggle
              checked={true}
              onChange={() => {}}
              disabled
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Startup">
        <SettingsRow
          title="Launch at login"
          copy="Start Ledge automatically when you log in."
          trailing={
            <Toggle
              checked={preferences.launchAtLogin}
              onChange={(checked) => void window.ledge.setPreferences({ launchAtLogin: checked })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Shake Gesture">
        <SettingsRow
          icon={<IconShake />}
          title="Excluded applications"
          copy="Skip shake detection in these apps. Enter one bundle ID per line (e.g. com.apple.Safari)."
          trailing={<span />}
          fullWidth
        >
          <div className="settings-field" style={{ padding: '8px 0 12px' }}>
            <textarea
              className="pref-input"
              rows={4}
              value={excludedDraft}
              onChange={(e) => { setExcludedDraft(e.target.value); setExcludedError(''); }}
              onBlur={() => void saveExcluded()}
              placeholder="com.apple.Safari&#10;com.apple.Terminal"
              spellCheck={false}
              style={{ resize: 'vertical', fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace", fontSize: '0.78rem' }}
            />
            {excludedError ? <p className="pref-status is-error">{excludedError}</p> : null}
            <p className="pref-help">One bundle identifier per line or comma-separated.</p>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Onboarding">
        <SettingsRow
          title="Reset onboarding"
          copy="Show the welcome guide again on next launch."
          trailing={
            <button
              className="settings-cta-small"
              type="button"
              onClick={() => {
                void window.ledge.setPreferences({ hasCompletedOnboarding: false });
                showToast('Onboarding will show on next launch');
              }}
            >
              Reset
            </button>
          }
        />
      </SettingsGroup>
    </>
  );
}

/* ── Shelf ── */

function ShelfSettings({ state, showToast }: { state: AppState; showToast(msg: string, kind?: 'success' | 'error'): void }) {
  const plan = usePlan(state);
  const interaction = state.preferences.shelfInteraction ?? {};
  const isPro = plan.isPro;
  const autoCloseEnabled = interaction.autoCloseShelf ?? false;
  const atRecentsCap = plan.recentShelvesUsed >= plan.recentShelvesLimit;

  async function updateShelfInteraction(patch: Partial<typeof interaction>) {
    try {
      await window.ledge.setPreferences({
        shelfInteraction: { ...interaction, ...patch },
      });
      showToast('Shelf settings updated');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update shelf settings', 'error');
    }
  }

  const autoCloseTitle = (
    <span className="settings-row-title-row">
      Auto-close shelf
      {!isPro && <ProBadge />}
    </span>
  );

  const autoCloseCopy = isPro
    ? 'Automatically close the shelf after dragging an item out.'
    : autoCloseEnabled
      ? 'Active locally. Pro required to sync this preference across devices.'
      : 'Pro feature. Upgrade to automatically close shelves after dragging an item out.';

  const autoClosePrompt = !isPro && (
    <ProUpgradePrompt
      message={
        autoCloseEnabled
          ? 'This preference is active locally but will not sync to other devices without Pro.'
          : 'Upgrade to Pro to use auto-close shelf and sync your preferences across devices.'
      }
      source="auto_close"
    />
  );

  return (
    <>
      <SettingsGroup title="Recent shelves">
        <SettingsRow
          icon={<IconSparkles />}
          title="Recent shelf history"
          copy={
            plan.isPro
              ? `${plan.recentShelvesUsed} of ${plan.recentShelvesLimit} slots used.`
              : `${plan.recentShelvesUsed} of ${plan.recentShelvesLimit} slots used. Older shelves are dropped first.`
          }
          trailing={
            atRecentsCap && !isPro ? (
              <button
                className="settings-cta-small"
                type="button"
                onClick={() => window.open('https://ledge.app/pro', '_blank')}
              >
                Get more
              </button>
            ) : (
              <span />
            )
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Item Actions">
        <SettingsRow
          icon={<IconSparkles />}
          title="Double-click files"
          copy="What happens when you double-click a file on a shelf."
          trailing={
            <Picker
              value={interaction.doubleClickAction ?? 'open'}
              onChange={(v) => void updateShelfInteraction({ doubleClickAction: v as 'open' | 'reveal' })}
            >
              <option value="open">Open file</option>
              <option value="reveal">Reveal in Finder</option>
            </Picker>
          }
        />
        <SettingsRow
          title="Shelf edge action"
          copy="Behavior when interacting with the shelf edge."
          trailing={
            <Picker
              value={interaction.shelfEdgeAction ?? 'dock'}
              onChange={(v) => void updateShelfInteraction({ shelfEdgeAction: v as 'dock' | 'close' })}
            >
              <option value="dock">Dock Shelf</option>
              <option value="close">Close Shelf</option>
            </Picker>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Automation">
        <SettingsRow
          icon={<IconMonitor />}
          title={autoCloseTitle}
          copy={autoCloseCopy}
          trailing={
            <Toggle
              checked={autoCloseEnabled}
              disabled={!isPro}
              onChange={(checked) => void updateShelfInteraction({ autoCloseShelf: checked })}
            />
          }
          fullWidth={!isPro}
        >
          {autoClosePrompt}
        </SettingsRow>
        <SettingsRow
          icon={<IconHand />}
          title="Snap into place"
          copy="Items snap to a grid when dropped on a shelf."
          trailing={
            <Toggle
              checked={interaction.snapToGrid ?? false}
              onChange={(checked) => void updateShelfInteraction({ snapToGrid: checked })}
            />
          }
        />
        <SettingsRow
          title="Auto-retract"
          copy="Minimize the shelf after a period of inactivity."
          trailing={
            <Toggle
              checked={interaction.autoRetract ?? false}
              onChange={(checked) => void updateShelfInteraction({ autoRetract: checked })}
            />
          }
        />
      </SettingsGroup>
    </>
  );
}

/* ── Activation ── */

function ActivationSettings({ state, showToast }: { state: AppState; showToast(msg: string, kind?: 'success' | 'error'): void }) {
  const preferences = state.preferences;
  const shortcutStatus = !preferences.globalShortcut
    ? 'Disabled'
    : state.permissionStatus.shortcutRegistered
      ? 'Active'
      : 'Unavailable';

  return (
    <>
      <SettingsGroup title="Gesture">
        <SettingsRow
          icon={<IconHand />}
          title="Activate with shake"
          copy="Shake your cursor while dragging to summon a shelf."
          trailing={
            <Toggle
              checked={preferences.shakeEnabled}
              onChange={(checked) => void window.ledge.setPreferences({ shakeEnabled: checked })}
            />
          }
        />
        <SettingsRow
          title="Sensitivity"
          copy="How vigorous the shake needs to be."
          trailing={
            <Picker
              value={preferences.shakeSensitivity}
              onChange={(v) => void window.ledge.setPreferences({ shakeSensitivity: v as ShakeSensitivity })}
            >
              <option value="gentle">Gentle</option>
              <option value="balanced">Balanced</option>
              <option value="firm">Firm</option>
            </Picker>
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Keyboard">
        <SettingsRow
          icon={<IconKeyboard />}
          title="Global shortcut"
          copy="Summon a shelf from anywhere with a keyboard shortcut."
          trailing={<span />}
          fullWidth
        >
          <div className="settings-field" style={{ padding: '8px 0 12px' }}>
            <ShortcutRecorder
              value={preferences.globalShortcut}
              onChange={async (shortcut) => {
                try {
                  await window.ledge.setPreferences({ globalShortcut: shortcut });
                  showToast('Shortcut updated');
                } catch {
                  showToast('Failed to update shortcut', 'error');
                }
              }}
            />
            <p className={`shortcut-status ${state.permissionStatus.shortcutError ? 'is-error' : ''}`}>
              {state.permissionStatus.shortcutError || shortcutStatus}
            </p>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Accessibility">
        <SettingsRow
          icon={<IconShield />}
          title="Accessibility access"
          copy={
            state.permissionStatus.accessibilityTrusted
              ? 'Granted. Shake detection is ready.'
              : 'Required for shake-to-open. Ledge uses macOS Accessibility to detect cursor motion.'
          }
          trailing={
            state.permissionStatus.accessibilityTrusted ? (
              <StatusPill label="Granted" variant="good" />
            ) : (
              <button
                className="settings-cta-small"
                type="button"
                onClick={() => void window.ledge.openPermissionSettings()}
              >
                Open Settings
              </button>
            )
          }
        />
        <SettingsRow
          title="Shake status"
          copy={
            preferences.shakeEnabled
              ? state.permissionStatus.shakeReady
                ? 'Ready to detect shakes'
                : 'Waiting for permissions'
              : 'Shake gesture is disabled'
          }
          trailing={
            <StatusPill
              label={
                preferences.shakeEnabled
                  ? state.permissionStatus.shakeReady
                    ? 'Ready'
                    : 'Blocked'
                  : 'Off'
              }
              variant={
                preferences.shakeEnabled && state.permissionStatus.shakeReady ? 'good' : 'neutral'
              }
            />
          }
        />
      </SettingsGroup>
    </>
  );
}

/* ── Cloud Sync ── */

function CloudSyncSettings({ state, showToast }: { state: AppState; showToast(msg: string, kind?: 'success' | 'error'): void }) {
  const sync = useSync();
  const isConfigured = sync.configured;
  const isLoggedIn = !!state.sync.signedInEmail;

  const [email, setEmail] = useState(state.sync.signedInEmail ?? '');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'verifying'>('idle');
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  useEffect(() => {
    setEmail(state.sync.signedInEmail ?? '');
  }, [state.sync.signedInEmail]);

  async function requestCode() {
    if (!email) return;
    setError('');
    setStatus('sending');
    try {
      await sync.requestOtp(email);
      setStatus('sent');
      setResendCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code. Please try again.');
      setStatus('idle');
    }
  }

  async function verifyCode() {
    if (code.length < 6) return;
    setError('');
    setStatus('verifying');
    try {
      await sync.verifyOtp(email, code);
      setStatus('idle');
      setCode('');
      showToast('Signed in successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Please try again.');
      setStatus('sent');
    }
  }

  async function handleSignOut() {
    if (!window.confirm('Sign out of Cloud Sync? Your local shelves will remain.')) return;
    try {
      await sync.signOut();
      showToast('Signed out');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to sign out', 'error');
    }
  }

  if (!isConfigured) {
    return (
      <SettingsGroup>
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <p className="settings-row-title" style={{ marginBottom: 8 }}>Cloud Sync is not configured</p>
          <p className="settings-row-copy">Set <code>VITE_CONVEX_URL</code> to enable cloud features.</p>
        </div>
      </SettingsGroup>
    );
  }

  if (isLoggedIn) {
    const overview = sync.overview;
    return (
      <>
        <SettingsGroup title="Account">
          <SettingsRow
            title="Status"
            trailing={<StatusPill label={state.sync.status} variant="good" />}
          />
          <SettingsRow title="Signed in as" copy={state.sync.signedInEmail} trailing={<span />} />
          <SettingsRow
            title={
              <span className="settings-row-title-row">
                Plan
                {overview && overview.plan === 'free' && <ProBadge />}
              </span>
            }
            copy={overview ? `${overview.plan.toUpperCase()} · ${overview.syncedShelfCount} / ${overview.shelfLimit} shelves` : `${state.sync.plan.toUpperCase()}`}
            trailing={<span />}
          />
          <SettingsRow
            title="Devices"
            copy={overview ? `${overview.deviceCount} / ${overview.deviceLimit} connected` : `${state.sync.deviceCount} connected`}
            trailing={<span />}
          />
          {overview && overview.storageBytesLimit > 0 && (
            <SettingsRow
              title="Storage"
              trailing={<span />}
              fullWidth
            >
              <div className="settings-field" style={{ padding: '8px 0 12px' }}>
                <div className="storage-bar-shell">
                  <div
                    className="storage-bar-fill"
                    style={{ width: `${Math.min(100, (overview.storageBytesUsed / overview.storageBytesLimit) * 100)}%` }}
                  />
                </div>
                <p className="pref-help">
                  {formatBytes(overview.storageBytesUsed)} of {formatBytes(overview.storageBytesLimit)} used
                </p>
              </div>
            </SettingsRow>
          )}
          {sync.sessionDaysRemaining !== null && (
            <SettingsRow
              title="Session"
              copy={`Expires in ${sync.sessionDaysRemaining} day${sync.sessionDaysRemaining === 1 ? '' : 's'}`}
              trailing={<span />}
            />
          )}
        </SettingsGroup>

        <SettingsGroup>
          <button
            className="settings-cta is-danger"
            type="button"
            onClick={() => void handleSignOut()}
          >
            Sign Out
          </button>
        </SettingsGroup>
      </>
    );
  }

  return (
    <>
      <SettingsGroup title="Cloud sync">
        <SettingsRow
          title="Status"
          copy="Sign in to keep your shelves in sync across devices."
          trailing={<StatusPill label={state.sync.status} variant="neutral" />}
        />
      </SettingsGroup>

      <SettingsGroup title="Email">
        <div className="settings-field">
          <input
            className="pref-input"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void requestCode(); }}
            placeholder="you@example.com"
            disabled={status === 'sending'}
          />
        </div>
        <button
          className="settings-cta"
          type="button"
          disabled={!email || status === 'sending'}
          onClick={() => void requestCode()}
        >
          {status === 'sending' ? 'Sending…' : 'Send Code'}
        </button>
      </SettingsGroup>

      {(status === 'sent' || status === 'verifying') && (
        <SettingsGroup title="Verification">
          <div className="settings-field">
            <input
              className="pref-input code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              disabled={status === 'verifying'}
              onKeyDown={(e) => { if (e.key === 'Enter') void verifyCode(); }}
            />
            <p className="pref-help">Check your email for a 6-digit verification code.</p>
          </div>
          <button
            className="settings-cta"
            type="button"
            disabled={code.length < 6 || status === 'verifying'}
            onClick={() => void verifyCode()}
          >
            {status === 'verifying' ? 'Verifying…' : 'Sign In'}
          </button>
          <button
            className="settings-link-btn"
            type="button"
            disabled={resendCooldown > 0}
            onClick={() => void requestCode()}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
          </button>
        </SettingsGroup>
      )}

      {error && <p className="pref-status is-error" style={{ margin: '0 4px' }}>{error}</p>}
    </>
  );
}

/* ── Pro ── */

const PRO_BENEFITS: { label: string; free: string; pro: string }[] = [
  { label: 'Shelf colors', free: '2 (Ember, Wave)', pro: '4 (Ember, Wave, Forest, Sand)' },
  { label: 'Recent shelves', free: '3', pro: '10' },
  { label: 'Synced shelves', free: '100', pro: '500' },
  { label: 'Connected devices', free: '1', pro: '3' },
  { label: 'Imported image storage', free: '—', pro: '1 GB' },
  { label: 'Preferences sync', free: '—', pro: 'Across devices' },
  { label: 'Auto-close shelf', free: '—', pro: 'Included' },
];

function ProSettings({ state, showToast }: { state: AppState; showToast(msg: string, kind?: 'success' | 'error'): void }) {
  const sync = useSync();
  const plan = usePlan(state);
  const [licenseKey, setLicenseKey] = useState('');
  const [orderId, setOrderId] = useState('');
  const [status, setStatus] = useState('');

  async function refresh() {
    if (!sync.configured) {
      setStatus('Cloud sync is not configured.');
      return;
    }
    setStatus('Refreshing…');
    try {
      await sync.refreshEntitlements({ licenseKey: licenseKey || undefined, orderId: orderId || undefined });
      setStatus('Entitlements refreshed.');
      showToast('Entitlements refreshed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh entitlements.';
      setStatus(message);
      showToast(message, 'error');
    }
  }

  return (
    <>
      <SettingsGroup>
        <div className="pro-hero">
          <div className="pro-plan-row">
            <p className="pro-eyebrow">Current plan</p>
            <StatusPill
              label={plan.isPro ? 'Ledge Pro' : 'Free'}
              variant={plan.isPro ? 'good' : 'neutral'}
            />
          </div>
          <p className="pro-price">$9.99 <span className="pro-price-suffix">/ year</span></p>
          <p className="pro-copy">Ledge Pro unlocks the full color palette, more recent shelves, cloud sync for all your devices, preferences sync, and auto-close.</p>
          {!plan.isPro && (
            <button
              className="settings-cta pro-cta"
              type="button"
              onClick={() => {
                if (import.meta.env.DEV) {
                  console.log('[analytics] pro_upgrade_clicked', { source: 'pro_section' });
                }
                window.open('https://ledge.app/pro', '_blank');
              }}
            >
              Upgrade to Pro
            </button>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Free vs Pro">
        <div className="pro-compare">
          <div className="pro-compare-head">
            <span />
            <span className="pro-compare-col is-free">Free</span>
            <span className="pro-compare-col is-pro">Pro</span>
          </div>
          {PRO_BENEFITS.map((row) => (
            <div key={row.label} className="pro-compare-row">
              <span className="pro-compare-label">{row.label}</span>
              <span className="pro-compare-cell is-free">{row.free}</span>
              <span className="pro-compare-cell is-pro">
                <IconCheck />
                <span>{row.pro}</span>
              </span>
            </div>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Activate license">
        <SettingsRow
          icon={<IconLock />}
          title="License key"
          copy="Paste a license key from your Lemon Squeezy receipt."
          trailing={<span />}
          fullWidth
        >
          <div className="settings-field" style={{ padding: '8px 0 6px' }}>
            <input
              className="pref-input"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="LEDGE-XXXX-XXXX"
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title="Order ID"
          copy="Or paste a Lemon Squeezy order ID to refresh entitlements."
          trailing={<span />}
          fullWidth
        >
          <div className="settings-field" style={{ padding: '6px 0 8px' }}>
            <input
              className="pref-input"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="#123456"
            />
            <button
              className="settings-cta"
              type="button"
              style={{ marginTop: 10 }}
              disabled={(!licenseKey && !orderId) || status === 'Refreshing…'}
              onClick={() => void refresh()}
            >
              {status === 'Refreshing…' ? 'Refreshing…' : 'Refresh Entitlements'}
            </button>
            {status && status !== 'Refreshing…' ? <p className="pref-status">{status}</p> : null}
          </div>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

/* ── About ── */

function AboutSettings() {
  const version = '0.1.9';

  return (
    <>
      <SettingsGroup>
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #0a84ff, #5e5ce6)',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 16px',
              color: '#fff',
              fontSize: 28,
              fontWeight: 700,
            }}
          >
            L
          </div>
          <p className="settings-row-title" style={{ fontSize: '1.1rem', marginBottom: 4 }}>
            Ledge
          </p>
          <p className="settings-row-copy" style={{ marginBottom: 16 }}>
            Version {version}
          </p>
          <p className="settings-row-copy">
            A macOS shelf utility for files, text, URLs, and images.
          </p>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Links">
        <SettingsRow
          title="Website"
          copy="ledge.app"
          trailing={
            <button className="settings-cta-small" type="button" onClick={() => window.open('https://ledge.app', '_blank')}>
              Open
            </button>
          }
        />
        <SettingsRow
          title="Support"
          copy="Get help and report issues"
          trailing={
            <button className="settings-cta-small" type="button" onClick={() => window.open('https://ledge.app/support', '_blank')}>
              Open
            </button>
          }
        />
      </SettingsGroup>

      <SettingsGroup>
        <p className="pref-help" style={{ textAlign: 'center', padding: '10px 16px' }}>
          © {new Date().getFullYear()} ollayor. All rights reserved.
        </p>
      </SettingsGroup>
    </>
  );
}

/* ── Shortcut Recorder ── */

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab']);
const ARROW_MAP: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

function ShortcutRecorder({ value, onChange }: { value: string; onChange(shortcut: string): void }) {
  const [isRecording, setIsRecording] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isRecording) return;

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setIsRecording(false);
        return;
      }

      const modifiers: string[] = [];
      if (e.metaKey) modifiers.push('Command');
      if (e.ctrlKey) modifiers.push('Control');
      if (e.altKey) modifiers.push('Option');
      if (e.shiftKey) modifiers.push('Shift');

      let key = ARROW_MAP[e.key] ?? e.key;
      if (key === ' ') key = 'Space';

      // Ignore lone modifier presses
      if (MODIFIER_KEYS.has(e.key) && modifiers.length === 0) {
        return;
      }
      if (MODIFIER_KEYS.has(e.key)) {
        key = ARROW_MAP[e.key] ?? e.key;
      }

      // Don't record just a modifier
      if (['Command', 'Control', 'Option', 'Shift'].includes(key)) {
        return;
      }

      const shortcut = [...modifiers, key].join('+');
      setIsRecording(false);
      onChange(shortcut);
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecording, onChange]);

  const keys = value ? value.split('+') : [];

  return (
    <div ref={containerRef} className="shortcut-recorder">
      {isRecording ? (
        <div className="shortcut-recorder-recording">
          <span className="shortcut-recorder-hint">Press a shortcut…</span>
          <button
            className="settings-cta-small"
            type="button"
            onClick={() => setIsRecording(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="shortcut-recorder-display">
          {keys.length > 0 ? (
            <div className="shortcut-keys">
              {keys.map((k) => (
                <kbd key={k} className="shortcut-key">{displayKey(k)}</kbd>
              ))}
            </div>
          ) : (
            <span className="shortcut-recorder-placeholder">No shortcut set</span>
          )}
          <button
            className="settings-cta-small"
            type="button"
            onClick={() => setIsRecording(true)}
          >
            {keys.length > 0 ? 'Change' : 'Record'}
          </button>
        </div>
      )}
    </div>
  );
}

function displayKey(key: string): string {
  const map: Record<string, string> = {
    Command: '⌘',
    Control: '⌃',
    Option: '⌥',
    Shift: '⇧',
    Return: '↩',
    Enter: '↩',
    Backspace: '⌫',
    Delete: '⌦',
    Escape: 'Esc',
    Tab: '⇥',
    Space: 'Space',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
    Home: 'Home',
    End: 'End',
  };
  return map[key] ?? key;
}

/* ── Shared UI ── */

function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="settings-group">
      {title ? <p className="settings-group-title">{title}</p> : null}
      <div className="settings-group-body">{children}</div>
    </div>
  );
}

interface SettingsRowProps {
  icon?: ReactNode;
  title: ReactNode;
  copy?: ReactNode;
  trailing: ReactNode;
  fullWidth?: boolean;
  children?: ReactNode;
}

function SettingsRow({ icon, title, copy, trailing, fullWidth, children }: SettingsRowProps) {
  return (
    <div className={`settings-row ${fullWidth ? 'is-full-width' : ''}`}>
      <div className="settings-row-main">
        {icon ? <span className="settings-row-icon">{icon}</span> : null}
        <div className="settings-row-text">
          <p className="settings-row-title">{title}</p>
          {copy ? <p className="settings-row-copy">{copy}</p> : null}
        </div>
      </div>
      <div className="settings-row-trailing">{trailing}</div>
      {children ? <div className="settings-row-children">{children}</div> : null}
    </div>
  );
}

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

interface PickerProps {
  value: string;
  onChange?(v: string): void;
  disabled?: boolean;
  children: ReactNode;
}

function Picker({ value, onChange, disabled = false, children }: PickerProps) {
  return (
    <select
      className="settings-picker"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled}
    >
      {children}
    </select>
  );
}

interface StatusPillProps {
  label: string;
  variant: 'good' | 'warn' | 'neutral';
}

function StatusPill({ label, variant }: StatusPillProps) {
  return (
    <span className={`settings-state-pill is-${variant}`}>
      {label}
    </span>
  );
}

/* ── Utilities ── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
