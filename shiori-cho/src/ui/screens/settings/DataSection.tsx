// 設定 → データ (docs/SPEC.md F15):
// - バックアップを書き出す: optional passphrase (≥ 8 characters, typed twice) → exportBackupFile → download
//   with the neutral name shiori-backup-YYYYMMDD.json.
// - バックアップから復元: file → (encrypted? ask the passphrase) → readBackupFile → preview counts →
//   まとめる / 置き換え (confirm) → applyBackup.
// - 保存の長持ち: status of navigator.storage.persist() + 「保存を長持ちさせる」.
// - 全データを消す: double confirmation, optional 工房 data, then the databases are deleted and the page reloads.
import { useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  applyBackup,
  backupErrorMessageJa,
  exportBackupFile,
  isEncryptedBackupText,
  isValidBackupPassphrase,
  readBackupFile,
  requestPersistentStorage,
} from '../../../app/backup';
import { download, readFileAsText } from '../../../app/platform';
import { DB_PLAYER, DB_STUDIO } from '../../../core/constants';
import type { BackupDataV1, ParseBackupResult } from '../../../core/types';
import { deleteIdbDatabase } from '../../../storage/idbRepo';
import { useRepo, useSettings, useUi } from '../../context';
import { formatDateTimeJa } from '../../format';
import { hrefFor } from '../../router';
import { errorMessageJa } from '../libraryShared';
import { SettingsSection } from './parts';
import { restartApp } from './restart';

/** Backups hold manifests (≤ 512 KiB each) and records; anything far larger is not a backup of this app. */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

export const MSG_PASSPHRASE_SHORT = 'パスフレーズは8文字以上にしてください';
export const MSG_PASSPHRASE_MISMATCH = '確認用のパスフレーズが一致しません';

export function DataSection({ id }: { id: string }): ReactNode {
  return (
    <SettingsSection id={id} icon="💾" title="データ" lead="記録はすべてこの端末の中だけに保存されています。機種変更やもしもに備えて、ときどきバックアップしてください。">
      <BackupExport />
      <hr className="divider" />
      <BackupImport />
      <hr className="divider" />
      <StoragePersist />
      <hr className="divider" />
      <DeleteAll />
    </SettingsSection>
  );
}

// ───────────────────────── export ─────────────────────────

function BackupExport(): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const ids = { enc: useId(), p1: useId(), p2: useId(), err: useId(), title: useId() };
  const [encrypt, setEncrypt] = useState(false);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (encrypt) {
      if (!isValidBackupPassphrase(p1)) {
        setError(MSG_PASSPHRASE_SHORT);
        return;
      }
      if (p1 !== p2) {
        setError(MSG_PASSPHRASE_MISMATCH);
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      const { filename, text } = await exportBackupFile(repo, encrypt ? { passphrase: p1 } : {});
      download(filename, text, 'application/json');
      setP1('');
      setP2('');
      ui.toast(`バックアップを書き出しました（${filename}）`, { tone: 'ok' });
    } catch (err) {
      ui.toast(errorMessageJa(err), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const last = settings.lastBackupAt;
  return (
    <form className="set-block" onSubmit={(e) => void submit(e)} noValidate aria-labelledby={ids.title}>
      <h3 id={ids.title} className="set-h3">
        バックアップを書き出す
      </h3>
      <p className="set-desc">
        {last === undefined ? 'まだ書き出したことはありません。' : `前回：${formatDateTimeJa(last)}`}
        {settings.changesSinceBackup > 0 ? `（その後の変更 ${settings.changesSinceBackup}件）` : ''}
      </p>
      <label className="set-check" htmlFor={ids.enc}>
        <input
          id={ids.enc}
          type="checkbox"
          checked={encrypt}
          onChange={(e) => {
            setEncrypt(e.target.checked);
            setError(null);
          }}
        />
        <span>パスフレーズで暗号化する</span>
      </label>
      {encrypt ? (
        <div className="set-subfields">
          <div className="field">
            <label htmlFor={ids.p1}>パスフレーズ（8文字以上）</label>
            <input
              id={ids.p1}
              className="input"
              type="password"
              autoComplete="new-password"
              value={p1}
              aria-invalid={error === MSG_PASSPHRASE_SHORT ? 'true' : undefined}
              aria-describedby={error ? ids.err : undefined}
              onChange={(e) => setP1(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.p2}>もう一度入力</label>
            <input
              id={ids.p2}
              className="input"
              type="password"
              autoComplete="new-password"
              value={p2}
              aria-invalid={error === MSG_PASSPHRASE_MISMATCH ? 'true' : undefined}
              aria-describedby={error ? ids.err : undefined}
              onChange={(e) => setP2(e.target.value)}
            />
          </div>
          <p className="field-hint">パスフレーズを忘れると、このバックアップは復元できません。</p>
        </div>
      ) : null}
      {error ? (
        <p id={ids.err} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="set-desc small">
        ファイル名は目立たない名前（shiori-backup-日付.json）です。中には作品名やメモが含まれます。PINは含まれません。
      </p>
      <div className="set-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? '書き出しています…' : 'バックアップを書き出す'}
        </button>
      </div>
    </form>
  );
}

// ───────────────────────── import ─────────────────────────

interface Loaded {
  data: BackupDataV1;
  encrypted: boolean;
  exportedAt: number;
}

type ParsedOk = Extract<ParseBackupResult, { ok: true }>;

function BackupImport(): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = { title: useId(), mode: useId(), preview: useId() };
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);

  const accept = (r: ParsedOk) => {
    setLoaded({ data: r.data, encrypted: r.encrypted, exportedAt: r.exportedAt });
    setMode('merge');
  };

  const onFile = async (file: File) => {
    if (file.size > MAX_BACKUP_BYTES) {
      ui.toast('ファイルが大きすぎます。しおり帳のバックアップファイルを選んでください', { tone: 'danger' });
      return;
    }
    setBusy(true);
    try {
      const text = await readFileAsText(file);
      if (!isEncryptedBackupText(text)) {
        const r = await readBackupFile(text);
        if (r.ok) accept(r);
        else ui.toast(backupErrorMessageJa(r.error), { tone: 'danger' });
        return;
      }
      // Encrypted: ask for the passphrase until it opens or the user cancels.
      for (;;) {
        const passphrase = await ui.prompt({
          title: 'パスフレーズを入力してください',
          body: 'このバックアップは暗号化されています。',
          label: 'パスフレーズ',
          inputType: 'password',
          okLabel: '開く',
          validate: (v) => (v === '' ? 'パスフレーズを入力してください' : null),
        });
        if (passphrase === null) return;
        const r = await readBackupFile(text, passphrase);
        if (r.ok) {
          accept(r);
          return;
        }
        ui.toast(backupErrorMessageJa(r.error), { tone: 'danger' });
        if (r.error !== 'passphrase') return;
      }
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!loaded || busy) return;
    const ok = await ui.confirm(
      mode === 'replace'
        ? {
            title: 'この端末のデータを置き換えますか？',
            body: 'いまの本棚・進捗・記録・メモは、バックアップの内容に置き換わります。元に戻せません。\nPINと年齢確認はそのままです。',
            okLabel: '置き換える',
            danger: true,
          }
        : {
            title: 'バックアップをまとめますか？',
            body: 'この端末のデータに、バックアップの内容を合わせます。同じ作品は新しいほうの情報が残ります。',
            okLabel: 'まとめる',
          },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const stats = await applyBackup(repo, loaded.data, mode);
      ui.toast(
        stats
          ? `まとめました（作品：追加${stats.worksAdded}・更新${stats.worksUpdated}）`
          : 'バックアップの内容に置き換えました',
        { tone: 'ok' },
      );
      setLoaded(null);
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const counts = loaded
    ? [
        { label: '作品', n: loaded.data.works.length },
        { label: '達成した項目', n: loaded.data.progress.filter((p) => !p.archived).length },
        { label: 'プレイ記録', n: loaded.data.sessions.length },
        { label: 'メモ', n: loaded.data.notes.length },
        { label: '入力した合言葉', n: loaded.data.redemptions.length },
        { label: '保留中の合言葉', n: loaded.data.pending.length },
      ]
    : [];

  return (
    <div className="set-block" aria-labelledby={ids.title} role="group">
      <h3 id={ids.title} className="set-h3">
        バックアップから復元
      </h3>
      <p className="set-desc">書き出したバックアップファイル（.json）を選んでください。</p>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onFile(file);
        }}
      />
      {loaded ? (
        <div className="set-preview" aria-labelledby={ids.preview} role="group">
          <p id={ids.preview} className="set-preview-title">
            {formatDateTimeJa(loaded.exportedAt)} のバックアップ{loaded.encrypted ? '（暗号化）' : ''}
          </p>
          <dl className="set-counts">
            {counts.map((c) => (
              <div key={c.label} className="set-count">
                <dt>{c.label}</dt>
                <dd>{c.n}</dd>
              </div>
            ))}
          </dl>
          <fieldset className="set-radios">
            <legend className="set-legend">復元のしかた</legend>
            <label className="set-radio">
              <input type="radio" name={ids.mode} checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span>
                <span className="set-radio-title">まとめる</span>
                <span className="set-radio-desc">この端末のデータとバックアップを合わせます（おすすめ）</span>
              </span>
            </label>
            <label className="set-radio">
              <input type="radio" name={ids.mode} checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span>
                <span className="set-radio-title">置き換え</span>
                <span className="set-radio-desc">この端末のデータを消して、バックアップの内容にします</span>
              </span>
            </label>
          </fieldset>
          <div className="set-actions">
            <button type="button" className="btn btn-primary" onClick={() => void restore()} disabled={busy} aria-busy={busy || undefined}>
              {busy ? '復元しています…' : '復元する'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setLoaded(null)} disabled={busy}>
              やめる
            </button>
          </div>
        </div>
      ) : (
        <div className="set-actions">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy} aria-busy={busy || undefined}>
            {busy ? '読み込んでいます…' : 'ファイルを選ぶ'}
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── storage persistence ─────────────────────────

function StoragePersist(): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const persist = settings.persist;

  const request = async () => {
    setBusy(true);
    try {
      const granted = await requestPersistentStorage(repo);
      ui.toast(
        granted ? '保存を長持ちにしました' : 'ブラウザに許可されませんでした。こまめなバックアップをおすすめします',
        { tone: granted ? 'ok' : 'default' },
      );
    } finally {
      setBusy(false);
    }
  };

  let status: ReactNode;
  if (persist?.granted) status = <span className="badge badge-ok">長持ち：有効</span>;
  else if (persist) status = <span className="badge badge-warn">長持ち：未許可</span>;
  else status = <span className="badge">長持ち：未設定</span>;

  return (
    <div className="set-block">
      <h3 className="set-h3">保存の状態</h3>
      <div className="set-status-row">
        <span>この端末のブラウザ</span>
        {status}
      </div>
      <p className="set-desc">
        {persist?.granted
          ? '空き容量が少なくなっても、ブラウザがデータを自動で消さないように設定されています。'
          : '空き容量が少ないときや長く使わなかったとき、ブラウザがデータを消すことがあります。'}
        {persist ? `（${formatDateTimeJa(persist.requestedAt)} に確認）` : ''}
      </p>
      <div className="set-actions">
        <button type="button" className="btn" onClick={() => void request()} disabled={busy} aria-busy={busy || undefined}>
          保存を長持ちさせる
        </button>
        <a className="btn btn-ghost" href={hrefFor({ name: 'help', section: 'ios' })}>
          iPhone・iPadの方へ
        </a>
      </div>
    </div>
  );
}

// ───────────────────────── delete all ─────────────────────────

function DeleteAll(): ReactNode {
  const ui = useUi();
  const checkId = useId();
  const [withStudio, setWithStudio] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const first = await ui.confirm({
      title: '全データを消しますか？',
      body:
        'この端末の本棚・進捗・プレイ記録・メモ・合言葉・設定がすべて消えます。元に戻せません。\n必要なら、先にバックアップを書き出してください。' +
        (withStudio ? '\nサークル工房のデータも消えます。' : ''),
      okLabel: '次へ',
      danger: true,
    });
    if (!first) return;
    const second = await ui.confirm({
      title: '本当に消しますか？',
      body: 'この操作は取り消せません。',
      okLabel: 'すべて消す',
      danger: true,
    });
    if (!second) return;
    setBusy(true);
    try {
      await deleteIdbDatabase(DB_PLAYER);
      if (withStudio) await deleteIdbDatabase(DB_STUDIO);
    } catch (e) {
      setBusy(false);
      ui.toast(errorMessageJa(e), { tone: 'danger' });
      return;
    }
    restartApp();
  };

  return (
    <div className="set-block set-danger">
      <h3 className="set-h3">全データを消す</h3>
      <p className="set-desc">この端末に保存したしおり帳のデータを、すべて消して最初の状態に戻します。</p>
      <label className="set-check" htmlFor={checkId}>
        <input id={checkId} type="checkbox" checked={withStudio} onChange={(e) => setWithStudio(e.target.checked)} />
        <span>サークル工房のデータも消す</span>
      </label>
      <div className="set-actions">
        <button type="button" className="btn btn-danger" onClick={() => void run()} disabled={busy} aria-busy={busy || undefined}>
          {busy ? '消しています…' : '全データを消す'}
        </button>
      </div>
    </div>
  );
}
