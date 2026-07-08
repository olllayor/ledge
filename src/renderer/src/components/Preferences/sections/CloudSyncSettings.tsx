import type { AppState } from '@shared/schema';
import { formatBytes } from '../formatBytes';
import { useState, useEffect } from 'react';
import { useSync } from '../../../providers/SyncProvider';
import { ProBadge } from '../../ProUpgradePrompt';
import { SettingsGroup, SettingsRow, StatusPill, type ShowToast } from '../primitives';


export function CloudSyncSettings({ state, showToast }: { state: AppState; showToast: ShowToast }) {
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
