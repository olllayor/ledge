import { IconLock, IconStar } from './PreferencesIcons';
import { useSync } from '../providers/SyncProvider';
import { isProCheckoutConfigured, openProCheckout } from '../lib/proCheckout';

interface ProUpgradePromptProps {
  message: string;
  ctaLabel?: string;
  source?: string;
}

export function ProUpgradePrompt({ message, ctaLabel = 'Upgrade to Pro', source }: ProUpgradePromptProps) {
  const { email } = useSync();
  const configured = isProCheckoutConfigured();
  const handleClick = () => {
    openProCheckout({ email, source });
  };

  return (
    <div className="pro-upgrade-prompt" role="note">
      <span className="pro-upgrade-prompt-icon" aria-hidden="true">
        <IconStar />
      </span>
      <div className="pro-upgrade-prompt-body">
        <p className="pro-upgrade-prompt-message">{message}</p>
        <button
          className="pro-upgrade-prompt-cta"
          type="button"
          disabled={!configured}
          onClick={handleClick}
        >
          {configured ? ctaLabel : 'Checkout not configured'}
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
