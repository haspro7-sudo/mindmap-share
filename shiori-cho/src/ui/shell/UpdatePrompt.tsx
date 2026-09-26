// F18 AC1: 「新しいバージョンがあります」 prompt via virtual:pwa-register/react (registerType 'prompt').
// Nothing is announced when the app becomes available offline (a neutral, quiet app is part of discretion).
import type { ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './UpdatePrompt.css';

export function UpdatePrompt(): ReactNode {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error: unknown) {
      console.warn('[shiori] service worker registration failed', error);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="upd" role="region" aria-label="アップデート">
      <p className="upd-text">新しいバージョンがあります</p>
      <div className="upd-actions">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNeedRefresh(false)}>
          あとで
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void updateServiceWorker(true)}>
          更新する
        </button>
      </div>
    </div>
  );
}
