import type { AppState } from '@shared/schema';
import { useState, useEffect, useCallback } from 'react';
import { IconClipboard } from '../../PreferencesIcons';
import { SettingsGroup, SettingsRow, Toggle, Picker, type ShowToast } from '../primitives';
import { ShortcutRecorder } from '../shortcutRecorder';


export function ClipboardSettings({ state, showToast }: { state: AppState; showToast: ShowToast }) {
  const settings = state.clipboardSettings;
  const [ignoredApps, setIgnoredApps] = useState(settings.ignoreBundleIds.join('\n'));

  useEffect(() => {
    setIgnoredApps(settings.ignoreBundleIds.join('\n'));
  }, [settings.ignoreBundleIds]);

  const updateSettings = useCallback(
    async (patch: Parameters<typeof window.ledge.clipboardSettingsUpdate>[0]) => {
      try {
        await window.ledge.clipboardSettingsUpdate(patch);
        showToast('Clipboard settings updated', 'success');
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Failed to update clipboard settings', 'error');
      }
    },
    [showToast],
  );

  const submitIgnoredApps = useCallback(() => {
    const list = ignoredApps
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    void updateSettings({ ignoreBundleIds: list });
  }, [ignoredApps, updateSettings]);

  return (
    <>
      <SettingsGroup title="History">
        <SettingsRow
          icon={<IconClipboard />}
          title="Enable clipboard history"
          copy="Mirror the system clipboard and keep a local rolling history. Off by default — opt in to start."
          trailing={
            <Toggle
              checked={settings.enabled}
              onChange={(checked) => void updateSettings({ enabled: checked })}
            />
          }
        />
        <SettingsRow
          title="History limit"
          copy="Maximum entries kept on disk. Older items are pruned automatically."
          trailing={
            <Picker
              value={String(settings.historyLimit)}
              onChange={(value) => void updateSettings({ historyLimit: Number.parseInt(value, 10) })}
              disabled={!settings.enabled}
            >
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </Picker>
          }
        />
        <SettingsRow
          title="Ignore password-manager pastes"
          copy="Skip items from apps that mark their pasteboard as concealed (1Password, Bitwarden, Apple Passwords)."
          trailing={
            <Toggle
              checked={settings.ignoreConcealedItems}
              onChange={(checked) => void updateSettings({ ignoreConcealedItems: checked })}
              disabled={!settings.enabled}
            />
          }
        />
        <SettingsRow
          title="Ignored apps"
          copy="One bundle id per line. Pastes from these apps are skipped."
          fullWidth
        >
          <textarea
            className="settings-textarea"
            value={ignoredApps}
            onChange={(event) => setIgnoredApps(event.target.value)}
            onBlur={submitIgnoredApps}
            disabled={!settings.enabled}
            rows={3}
            spellCheck={false}
            placeholder="com.apple.Safari&#10;com.figma.Desktop"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Quick Paste">
        <SettingsRow
          title="Global hotkey"
          copy="Bring up the floating palette from anywhere. Cmd+Shift+V by default."
          trailing={
            <ShortcutRecorder
              value={settings.quickPasteHotkey}
              onChange={(value) => void updateSettings({ quickPasteHotkey: value })}
              disabled={!settings.enabled}
            />
          }
        />
        <SettingsRow
          title="Synthetic paste (Accessibility)"
          copy="Opt in: after writing to the clipboard, also send a ⌘V keystroke via osascript. May be blocked by some apps."
          trailing={
            <Toggle
              checked={settings.syntheticPasteEnabled}
              onChange={(checked) => void updateSettings({ syntheticPasteEnabled: checked })}
              disabled={!settings.enabled}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Peek Window">
        <SettingsRow
          title="Peek hotkey"
          copy="Toggle the floating thumbnail strip below the menu bar. Empty = off."
          trailing={
            <ShortcutRecorder
              value={settings.peekHotkey}
              onChange={(value) => void updateSettings({ peekHotkey: value })}
              disabled={!settings.enabled}
            />
          }
        />
      </SettingsGroup>
    </>
  );
}
