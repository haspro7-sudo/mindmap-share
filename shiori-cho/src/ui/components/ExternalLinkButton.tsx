// DLsite store link (docs/SPEC.md F2 AC5, F12 AC3, §7.3): hidden when discreet.hideStoreLinks (and for an
// invalid code); a confirm dialog comes first, then window.open(url, '_blank', 'noopener,noreferrer').
// This is the ONLY place in the UI that opens an external site.
import type { ReactNode } from 'react';
import { isCoarsePointer } from '../../app/platform';
import { buildStoreUrl, parseStoreCode } from '../../core/storeCode';
import { useSettings, useUi } from '../context';

export interface ExternalLinkButtonProps {
  storeCode: string;
  label?: string;
}

export const EXTERNAL_CONFIRM_TITLE = '外部サイト（DLsite）を開きます。よろしいですか？';

export function ExternalLinkButton({ storeCode, label = '作品ページを開く' }: ExternalLinkButtonProps): ReactNode {
  const { settings } = useSettings();
  const ui = useUi();
  if (settings.discreet.hideStoreLinks) return null;
  const parsed = parseStoreCode(storeCode);
  if (!parsed) return null;

  const onClick = async () => {
    const ok = await ui.confirm({
      title: EXTERNAL_CONFIRM_TITLE,
      body: 'しおり帳の外のページが、新しいタブで開きます。',
      okLabel: '開く',
    });
    if (!ok) return;
    try {
      window.open(buildStoreUrl(parsed, { touch: isCoarsePointer() }), '_blank', 'noopener,noreferrer');
    } catch {
      ui.toast('ページを開けませんでした', { tone: 'danger' });
    }
  };

  return (
    <button type="button" className="btn" onClick={() => void onClick()}>
      <span>{label}</span>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path
          d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="visually-hidden">（外部サイト）</span>
    </button>
  );
}
