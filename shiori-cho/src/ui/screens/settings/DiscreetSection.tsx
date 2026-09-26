// 設定 → おしのびモード (docs/SPEC.md F2): four switches with one-line explanations, and the camouflage
// notepad text (what 「隠す」 shows), with a 「隠すを試す」 button.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { DiscreetSettings } from '../../../core/types';
import { useSettings, useUi } from '../../context';
import { errorMessageJa } from '../libraryShared';
import { SettingsSection, SwitchRow } from './parts';

const SWITCHES: ReadonlyArray<{ key: keyof DiscreetSettings; title: string; description: string }> = [
  {
    key: 'aliasOnly',
    title: '表示名で隠す',
    description: '一覧や見出しで、作品名のかわりに「作品A」のような表示名を使います。',
  },
  {
    key: 'blurOnHide',
    title: '切り替え画面で中身を隠す',
    description: 'ほかのアプリに切り替えたとき、画面を無地で覆います。',
  },
  {
    key: 'hideStoreLinks',
    title: '作品ページのリンクを隠す',
    description: 'DLsiteの作品ページを開くボタンを表示しません。',
  },
  {
    key: 'blurExtras',
    title: 'おまけの本文をぼかす',
    description: 'おまけを開いたとき、タップするまで本文をぼかします。',
  },
];

export function DiscreetSection({ id }: { id: string }): ReactNode {
  const { settings, update } = useSettings();
  const ui = useUi();

  const setSwitch = async (key: keyof DiscreetSettings, value: boolean) => {
    try {
      // Only the changed key: updateSettings merges `discreet` key-wise, so quick taps on two switches
      // never overwrite each other with a stale copy.
      const patch: Partial<DiscreetSettings> = { [key]: value };
      await update({ discreet: patch as DiscreetSettings });
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  return (
    <SettingsSection id={id} icon="🕶️" title="おしのびモード" lead="人前でも気兼ねなく使うための設定です。">
      <div className="set-switches">
        {SWITCHES.map((s) => (
          <SwitchRow
            key={s.key}
            title={s.title}
            description={s.description}
            checked={settings.discreet[s.key]}
            onChange={(v) => void setSwitch(s.key, v)}
          />
        ))}
      </div>
      <CamouflageEditor />
    </SettingsSection>
  );
}

function CamouflageEditor(): ReactNode {
  const { settings, update } = useSettings();
  const ui = useUi();
  const textId = useId();
  const hintId = useId();
  const saved = settings.camouflageText;
  const [text, setText] = useState(saved);
  const [base, setBase] = useState(saved);
  const [busy, setBusy] = useState(false);

  // The notepad itself also saves this text: follow outside changes while nothing is being edited here.
  if (saved !== base) {
    setBase(saved);
    if (text === base) setText(saved);
  }
  const dirty = text !== saved;

  const save = async (): Promise<boolean> => {
    setBusy(true);
    try {
      await update({ camouflageText: text });
      return true;
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (await save()) ui.toast('メモを保存しました', { tone: 'ok' });
  };

  const tryHide = async () => {
    if (dirty && !(await save())) return;
    ui.hide();
  };

  return (
    <div className="set-camo">
      <h3 className="set-h3">隠したときのメモ画面</h3>
      <p id={hintId} className="set-desc">
        画面上の「隠す」（パソコンではEscキー）で、ふつうのメモ帳に切り替わります。戻るときは「メモ」の見出しを1秒長押しします。
      </p>
      <div className="set-camo-preview">
        <div className="set-camo-bar" aria-hidden="true">
          メモ
        </div>
        <label htmlFor={textId} className="visually-hidden">
          メモ画面に表示する文章
        </label>
        <textarea
          id={textId}
          className="set-camo-text"
          value={text}
          rows={4}
          placeholder="（空のままでもかまいません）"
          aria-describedby={hintId}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="set-actions">
        <button type="button" className="btn btn-sm" onClick={() => void onSave()} disabled={!dirty || busy}>
          メモを保存
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void tryHide()} disabled={busy}>
          隠すを試す
        </button>
      </div>
    </div>
  );
}
