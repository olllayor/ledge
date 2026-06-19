import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppVersion } from '../hooks/useAppVersion';
import type { AppState } from '@shared/schema';
import { IconGear } from './Icons';
import {
  IconApp,
  IconBolt,
  IconCloud,
  IconInfo,
  IconSparkles,
  IconStar,
  IconClipboard,
} from './PreferencesIcons';
import { GeneralSettings } from './Preferences/sections/GeneralSettings';
import { ShelfSettings } from './Preferences/sections/ShelfSettings';
import { ActivationSettings } from './Preferences/sections/ActivationSettings';
import { ClipboardSettings } from './Preferences/sections/ClipboardSettings';
import { CloudSyncSettings } from './Preferences/sections/CloudSyncSettings';
import { ProSettings } from './Preferences/sections/ProSettings';
import { AboutSettings } from './Preferences/sections/AboutSettings';

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
  { id: 'clipboard', label: 'Clipboard', icon: <IconClipboard /> },
  { id: 'cloud', label: 'Cloud Sync', icon: <IconCloud /> },
  { id: 'pro', label: 'Ledge Pro', icon: <IconStar /> },
  { id: 'about', label: 'About', icon: <IconInfo /> },
];

export function PreferencesView({ state }: PreferencesViewProps) {
  const appVersion = useAppVersion();
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
    clipboard: { title: 'Clipboard', subtitle: 'History, quick paste, and the floating peek window.' },
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
          <p>{appVersion ? `Ledge ${appVersion}` : 'Ledge'}</p>
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
          {activeSection === 'clipboard' && <ClipboardSettings state={state} showToast={showToast} />}
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


