import { IconLock, IconStar } from './PreferencesIcons';

interface ProUpgradePromptProps {
  message: string;
  ctaLabel?: string;
  source?: string;
}

export function ProUpgradePrompt({ message, ctaLabel = 'Upgrade to Pro', source }: ProUpgradePromptProps) {
  const handleClick = () => {
    if (typeof window !== 'undefined' && import.meta.env.DEV) {
      console.log('[analytics] pro_upgrade_clicked', { source: source ?? 'unknown' });
    }
    window.open('https://ledge.app/pro', '_blank');
  };

  return (
    <div className="pro-upgrade-prompt" role="note">
      <span className="pro-upgrade-prompt-icon" aria-hidden="true">
        <IconStar />
      </span>
      <div className="pro-upgrade-prompt-body">
        <p className="pro-upgrade-prompt-message">{message}</p>
        <button className="pro-upgrade-prompt-cta" type="button" onClick={handleClick}>
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

export function ProBadge() {
  return (
    <span className="pro-badge" aria-label="Pro feature">
      <IconLock />
      <span>Pro</span>
    </span>
  );
}
