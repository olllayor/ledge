import { useEffect, useState } from 'react';

/**
 * Returns the running app's version string, fetched from the main process
 * via `app.getVersion()`. Returns an empty string while the value is in
 * flight so consumers can render a placeholder.
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState('');

  useEffect(() => {
    let active = true;
    void window.ledge
      .getAppVersion()
      .then((next) => {
        if (active) {
          setVersion(next);
        }
      })
      .catch(() => {
        // Swallow: the sidebar will just show "Ledge" without a version.
      });
    return () => {
      active = false;
    };
  }, []);

  return version;
}
