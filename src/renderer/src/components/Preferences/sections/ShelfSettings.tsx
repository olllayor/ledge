import type { AppState } from '@shared/schema';
import { usePlan } from '../../../hooks/usePlan';
import { ProBadge, ProUpgradePrompt } from '../../ProUpgradePrompt';
import { IconMonitor, IconSparkles } from '../../PreferencesIcons';
import { SettingsGroup, SettingsRow, Toggle, Picker, type ShowToast } from '../primitives';


export function ShelfSettings({ state, showToast }: { state: AppState; showToast: ShowToast }) {
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
          title="Auto-retract"
          copy="Hide the shelf after 60 seconds of inactivity."
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
