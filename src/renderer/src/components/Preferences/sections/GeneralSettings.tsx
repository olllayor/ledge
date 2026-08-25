import type { AppState } from '@shared/schema';
import { useState, useEffect } from 'react';
import { IconShake } from '../../PreferencesIcons';
import { SettingsGroup, SettingsRow, Toggle, StatusPill, type ShowToast } from '../primitives';


export function GeneralSettings({ state, showToast }: { state: AppState; showToast: ShowToast }) {
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
        {preferences.launchAtLogin ? (
          <SettingsRow
            title="Login item status"
            copy={
              state.permissionStatus.loginItemOpenAtLogin
                ? state.permissionStatus.loginItemWasOpenedAsHidden
                  ? 'Ledge starts hidden in the background at login — tray icon only, no windows.'
                  : 'Ledge will start at your next login.'
                : 'macOS hasn’t confirmed the login item yet. Check System Settings › General › Login Items.'
            }
            trailing={
              <StatusPill
                label={
                  state.permissionStatus.loginItemOpenAtLogin ? 'Starts hidden' : 'Check Login Items'
                }
                variant={state.permissionStatus.loginItemOpenAtLogin ? 'good' : 'warn'}
              />
            }
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Shake Gesture">
        <SettingsRow
          icon={<IconShake />}
          title="Excluded applications"
          copy="Skip shake detection in these apps. One bundle ID per line or comma-separated (e.g. com.apple.Safari)."
          fullWidth
        >
          <div className="settings-field" style={{ padding: '8px 0 12px' }}>
            <textarea
              className="settings-textarea"
              rows={4}
              value={excludedDraft}
              onChange={(e) => { setExcludedDraft(e.target.value); setExcludedError(''); }}
              onBlur={() => void saveExcluded()}
              placeholder="com.apple.Safari&#10;com.apple.Terminal"
              spellCheck={false}
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
