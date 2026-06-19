import { LedgeMark } from '../../PreferencesIcons';
import { SettingsGroup, SettingsRow } from '../primitives';

export function AboutSettings() {
  const version = '0.1.9';

  return (
    <>
      <SettingsGroup>
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <div style={{ margin: '0 auto 16px' }}>
            <LedgeMark size={72} alt="Ledge logo" />
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
