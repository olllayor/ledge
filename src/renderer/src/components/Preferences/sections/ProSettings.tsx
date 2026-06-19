import type { AppState } from '@shared/schema';
import { useState } from 'react';
import { usePlan } from '../../../hooks/usePlan';
import { useSync } from '../../../providers/SyncProvider';
import { IconLock, IconCheck } from '../../PreferencesIcons';
import { SettingsGroup, SettingsRow, StatusPill, type ShowToast } from '../primitives';


const PRO_BENEFITS: { label: string; free: string; pro: string }[] = [
  { label: 'Shelf colors', free: '2 (Ember, Wave)', pro: '4 (Ember, Wave, Forest, Sand)' },
  { label: 'Recent shelves', free: '3', pro: '10' },
  { label: 'Synced shelves', free: '100', pro: '500' },
  { label: 'Connected devices', free: '1', pro: '3' },
  { label: 'Imported image storage', free: '—', pro: '1 GB' },
  { label: 'Preferences sync', free: '—', pro: 'Across devices' },
  { label: 'Auto-close shelf', free: '—', pro: 'Included' },
];

export function ProSettings({ state, showToast }: { state: AppState; showToast: ShowToast }) {
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
