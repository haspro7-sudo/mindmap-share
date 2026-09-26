// #/settings 設定 (docs/SPEC.md §6): おしのびモード (F2), 画面ロック (F3), データ (F15), サークル向け (→ 工房),
// ヘルプ (F19), サンプル (F17), このアプリについて, 年齢確認の取り消し (F1 AC3).
// A small in-page index scrolls to each section (buttons, not '#…' links: the hash is the router's).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { prefersReducedMotion } from '../../app/platform';
import { APP_NAME_EN, APP_NAME_JA, APP_VERSION, DISCLAIMER_JA, NOT_DRM_JA } from '../../core/constants';
import { useSettings, useUi } from '../context';
import { hrefFor } from '../router';
import { errorMessageJa, useTrySamples } from './libraryShared';
import { DataSection } from './settings/DataSection';
import { DiscreetSection } from './settings/DiscreetSection';
import { LockSection } from './settings/LockSection';
import { LinkRow, SettingsSection } from './settings/parts';
import './Settings.css';

const SECTIONS = [
  { id: 'set-discreet', label: 'おしのび' },
  { id: 'set-lock', label: '画面ロック' },
  { id: 'set-data', label: 'データ' },
  { id: 'set-more', label: 'サークル・ヘルプ' },
  { id: 'set-about', label: 'このアプリ' },
] as const;

function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  document.getElementById(`${id}-title`)?.focus({ preventScroll: true });
}

export function SettingsScreen(): ReactNode {
  return (
    <main className="screen set">
      <h1 className="set-title">設定</h1>
      <nav className="set-nav" aria-label="設定の項目">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className="chip set-nav-chip" onClick={() => jumpTo(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>

      <DiscreetSection id="set-discreet" />
      <LockSection id="set-lock" />
      <DataSection id="set-data" />
      <MoreSection id="set-more" />
      <AboutSection id="set-about" />
    </main>
  );
}

function MoreSection({ id }: { id: string }): ReactNode {
  const trySamples = useTrySamples();
  const [busy, setBusy] = useState(false);
  const onSamples = async () => {
    setBusy(true);
    await trySamples();
    setBusy(false);
  };

  return (
    <SettingsSection id={id} icon="🧭" title="サークル向け・ヘルプ">
      <h3 className="set-h3">サークル向け</h3>
      <p className="set-desc">作品に「しおりファイル」を付けたいサークル向けの編集ツールです。合言葉やおまけを作って、同梱用のファイルを書き出せます。</p>
      <LinkRow href={hrefFor({ name: 'studio' })} icon="🛠️" title="サークル工房を開く" />
      <LinkRow href={hrefFor({ name: 'help', section: 'creators' })} icon="📐" title="サークル向けガイド" />

      <hr className="divider" />
      <h3 className="set-h3">ヘルプ</h3>
      <div className="set-links">
        <LinkRow href={hrefFor({ name: 'help', section: 'usage' })} icon="📖" title="使い方" />
        <LinkRow href={hrefFor({ name: 'help', section: 'ios' })} icon="📱" title="iOSでの注意" />
        <LinkRow href={hrefFor({ name: 'help', section: 'privacy' })} icon="🛡️" title="プライバシー" />
      </div>

      <hr className="divider" />
      <h3 className="set-h3">サンプル</h3>
      <p className="set-desc">架空の作品2つ（サンプルA・サンプルB）で、合言葉やおまけの流れを試せます。</p>
      <div className="set-actions">
        <button type="button" className="btn" onClick={() => void onSamples()} disabled={busy} aria-busy={busy || undefined}>
          サンプルを試す
        </button>
      </div>
      <div className="set-links">
        <LinkRow href={hrefFor({ name: 'help', section: 'demo-codes' })} icon="🔑" title="サンプルの合言葉" />
        <LinkRow href={hrefFor({ name: 'demoPc' })} icon="🖥️" title="PC画面シミュレータ" description="ゲーム画面に合言葉が出るようすを試せます" />
      </div>
    </SettingsSection>
  );
}

function AboutSection({ id }: { id: string }): ReactNode {
  const { update } = useSettings();
  const ui = useUi();

  const revokeAge = async () => {
    const ok = await ui.confirm({
      title: '年齢確認を取り消しますか？',
      body: '取り消すと、年齢確認の画面に戻ります。データは消えません。',
      okLabel: '取り消す',
    });
    if (!ok) return;
    try {
      await update({ ageConfirmedAt: undefined });
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  return (
    <SettingsSection id={id} icon="🔖" title="このアプリについて">
      <p className="set-about-name">
        {APP_NAME_JA}
        <span className="set-about-en">{APP_NAME_EN}</span>
        <span className="badge set-about-ver">v{APP_VERSION}</span>
      </p>
      <ul className="set-about-list">
        <li>{DISCLAIMER_JA}</li>
        <li>{NOT_DRM_JA}</li>
        <li>データはこの端末の中だけに保存されます。サーバーやアカウントはなく、外部への送信もありません。</li>
        <li>
          React（React DOM・Scheduler を含む）、zod、idb、fflate、qrcode-generator、Workbox、Vite などのオープンソースソフトウェアを利用しています。ライセンスの全文は「くわしく見る」から確認できます。
        </li>
      </ul>
      <LinkRow href={hrefFor({ name: 'help', section: 'about' })} icon="ℹ️" title="くわしく見る" />

      <hr className="divider" />
      <h3 className="set-h3">年齢確認</h3>
      <p className="set-desc">年齢確認は自己申告です。取り消すと、すぐに確認の画面に戻ります。</p>
      <div className="set-actions">
        <button type="button" className="btn" onClick={() => void revokeAge()}>
          年齢確認を取り消す
        </button>
      </div>
    </SettingsSection>
  );
}
