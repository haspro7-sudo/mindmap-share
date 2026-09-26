// 設定 → 画面ロック (docs/SPEC.md F3): set / change / remove the PIN (4–8 digits, PBKDF2 via hashPin; the
// current PIN is re-entered and checked with verifyPin before a change or removal), the auto-lock delay,
// 「今すぐロック」, and the honest note that this is a screen lock, not encryption.
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { hashPin, isValidPinFormat, verifyPin } from '../../../core/crypto/pin';
import type { Settings } from '../../../core/types';
import { useSettings, useUi } from '../../context';
import { errorMessageJa } from '../libraryShared';
import { SettingsSection } from './parts';

type Mode = 'set' | 'change' | 'remove';

const AUTO_LOCK_OPTIONS: ReadonlyArray<{ value: Settings['autoLockSec']; label: string }> = [
  { value: 0, label: 'すぐ' },
  { value: 30, label: '30秒' },
  { value: 60, label: '1分' },
  { value: 300, label: '5分' },
];

export const MSG_PIN_FORMAT = 'PINは4〜8桁の数字で入力してください';
export const MSG_PIN_MISMATCH = '確認用のPINが一致しません';
export const MSG_PIN_WRONG = 'いまのPINが違います';

export function LockSection({ id }: { id: string }): ReactNode {
  const { settings, update } = useSettings();
  const ui = useUi();
  const [mode, setMode] = useState<Mode | null>(null);
  const selectId = useId();
  const hasPin = settings.pin !== undefined;

  const setAutoLock = async (value: Settings['autoLockSec']) => {
    try {
      await update({ autoLockSec: value });
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  return (
    <SettingsSection id={id} icon="🔒" title="画面ロック" lead="アプリを開くときに、4〜8桁のPINを求めます。">
      <div className="set-status-row">
        <span>PIN</span>
        {hasPin ? <span className="badge badge-ok">設定済み</span> : <span className="badge">未設定</span>}
      </div>

      {mode ? (
        <PinForm key={mode} mode={mode} onDone={() => setMode(null)} />
      ) : hasPin ? (
        <div className="set-actions">
          <button type="button" className="btn" onClick={() => setMode('change')}>
            PINを変える
          </button>
          <button type="button" className="btn" onClick={() => setMode('remove')}>
            PINを外す
          </button>
          <button type="button" className="btn" onClick={() => ui.lockNow()}>
            今すぐロック
          </button>
        </div>
      ) : (
        <div className="set-actions">
          <button type="button" className="btn btn-primary" onClick={() => setMode('set')}>
            PINを設定する
          </button>
        </div>
      )}

      {hasPin ? (
        <div className="field set-field">
          <label htmlFor={selectId}>自動ロックまでの時間</label>
          <select
            id={selectId}
            className="select"
            value={settings.autoLockSec}
            onChange={(e) => void setAutoLock(Number(e.target.value) as Settings['autoLockSec'])}
          >
            {AUTO_LOCK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="field-hint">アプリから離れてこの時間がたつと、戻ったときにPINを求めます。</p>
        </div>
      ) : null}

      <p className="set-note">
        <span aria-hidden="true">ℹ️ </span>画面ロックです。保存データそのものは暗号化されません。PINを忘れると、全データを消して初期化するしかありません。
      </p>
    </SettingsSection>
  );
}

function PinForm({ mode, onDone }: { mode: Mode; onDone(): void }): ReactNode {
  const { settings, update } = useSettings();
  const ui = useUi();
  const ids = { current: useId(), pin1: useId(), pin2: useId(), err: useId(), title: useId() };
  const [current, setCurrent] = useState('');
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const needsCurrent = mode !== 'set';
  const needsNew = mode !== 'remove';

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const title = mode === 'set' ? 'PINを設定する' : mode === 'change' ? 'PINを変える' : 'PINを外す';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (needsCurrent && !isValidPinFormat(current)) {
      setError('いまのPINを入力してください');
      return;
    }
    if (needsNew) {
      if (!isValidPinFormat(pin1)) {
        setError(MSG_PIN_FORMAT);
        return;
      }
      if (pin1 !== pin2) {
        setError(MSG_PIN_MISMATCH);
        return;
      }
    }
    setError(null);
    setBusy(true);
    try {
      if (needsCurrent) {
        const ok = settings.pin !== undefined && (await verifyPin(current, settings.pin));
        if (!ok) {
          setError(MSG_PIN_WRONG);
          setCurrent('');
          firstRef.current?.focus();
          return;
        }
      }
      if (mode === 'remove') {
        await update({ pin: undefined, pinFailures: 0, pinCooldownUntil: undefined });
        ui.toast('PINを外しました', { tone: 'ok' });
      } else {
        const pin = await hashPin(pin1);
        await update({ pin, pinFailures: 0, pinCooldownUntil: undefined });
        ui.toast(mode === 'set' ? 'PINを設定しました' : 'PINを変えました', { tone: 'ok' });
      }
      onDone();
    } catch (err) {
      setError(errorMessageJa(err));
    } finally {
      setBusy(false);
    }
  };

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);
  const describedBy = error ? ids.err : undefined;

  return (
    <form className="set-subform" onSubmit={(e) => void submit(e)} noValidate aria-labelledby={ids.title}>
      <h3 id={ids.title} className="set-h3">
        {title}
      </h3>
      {needsCurrent ? (
        <div className="field">
          <label htmlFor={ids.current}>いまのPIN</label>
          <input
            ref={firstRef}
            id={ids.current}
            className="input set-pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={8}
            value={current}
            aria-invalid={error === MSG_PIN_WRONG ? 'true' : undefined}
            aria-describedby={describedBy}
            onChange={(e) => setCurrent(digits(e.target.value))}
          />
        </div>
      ) : null}
      {needsNew ? (
        <>
          <div className="field">
            <label htmlFor={ids.pin1}>{mode === 'set' ? 'PIN（4〜8桁の数字）' : '新しいPIN（4〜8桁の数字）'}</label>
            <input
              ref={needsCurrent ? undefined : firstRef}
              id={ids.pin1}
              className="input set-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={pin1}
              aria-describedby={describedBy}
              onChange={(e) => setPin1(digits(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor={ids.pin2}>もう一度入力</label>
            <input
              id={ids.pin2}
              className="input set-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={pin2}
              aria-describedby={describedBy}
              onChange={(e) => setPin2(digits(e.target.value))}
            />
          </div>
        </>
      ) : null}
      {error ? (
        <p id={ids.err} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="set-actions">
        <button type="submit" className={`btn ${mode === 'remove' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} aria-busy={busy || undefined}>
          {busy ? (mode === 'remove' ? '確かめています…' : '保存しています…') : mode === 'remove' ? 'PINを外す' : mode === 'set' ? '設定する' : '変える'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone} disabled={busy}>
          やめる
        </button>
      </div>
    </form>
  );
}
