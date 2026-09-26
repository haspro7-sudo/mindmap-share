// F2 AC4: an opaque, neutral veil shown while document.hidden (when discreet.blurOnHide), so task-switcher
// snapshots show nothing. It disappears as soon as the page is visible again.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSettings } from '../context';
import './PrivacyVeil.css';

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function PrivacyVeil(): ReactNode {
  const { settings } = useSettings();
  const [hidden, setHidden] = useState(isHidden);

  useEffect(() => {
    const onChange = () => setHidden(isHidden());
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('pagehide', onChange);
    window.addEventListener('pageshow', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('pagehide', onChange);
      window.removeEventListener('pageshow', onChange);
    };
  }, []);

  if (!hidden || !settings.discreet.blurOnHide) return null;
  return <div className="veil" aria-hidden="true" data-testid="privacy-veil" />;
}
