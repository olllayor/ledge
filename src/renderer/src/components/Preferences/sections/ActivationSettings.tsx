import type { AppState, ShakeSensitivity } from '@shared/schema';
import { IconHand, IconKeyboard, IconShield } from '../../PreferencesIcons';
import { SettingsGroup, SettingsRow, Toggle, Picker, StatusPill, type ShowToast } from '../primitives';
import { ShortcutRecorder } from '../shortcutRecorder';


export function ActivationSettings({ state, showToast }: { state: AppState; showToast: ShowToast }) {
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
