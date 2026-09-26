// F3: PIN pad (buttons and the keyboard), verifyPin, failure counter in settings.pinFailures; after 5 wrong
// PINs a 30 s cooldown is stored in pinCooldownUntil (survives reloads) and counted down on screen; success
// resets both. 「PINを忘れた」 explains that the only way out is 全データを消して初期化 (double confirm → onWipe).
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { PIN_COOLDOWN_MS, PIN_MAX_FAILURES } from '../../core/constants';
import { verifyPin } from '../../core/crypto/pin';
import { isShioriError } from '../../core/errors';
import { useLatest } from '../components/useLatest';
import { useSettings, useUi } from '../context';
import { BrandMark } from './BrandMark';
import './gate.css';
import './LockScreen.css';

const MAX_DIGITS = 8;
const MIN_DIGITS = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export function LockScreen({ onUnlock, onWipe }: { onUnlock(): void; onWipe(): void }): ReactNode {
  const { settings, update } = useSettings();
  const ui = useUi();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [forgot, setForgot] = useState(false);
  const settingsRef = useLatest(settings);

  const cooldownUntil = settings.pinCooldownUntil ?? 0;
  const coolingDown = cooldownUntil > now;
  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const inputDisabled = busy || coolingDown;

  // Tick once per second while a cooldown is running.
  useEffect(() => {
    if (!coolingDown) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [coolingDown]);

  const submit = useCallback(
    async (value: string) => {
      const s = settingsRef.current;
      if (busy || (s.pinCooldownUntil ?? 0) > Date.now()) return;
      if (value.length < MIN_DIGITS) {
        setMessage(`PINは${MIN_DIGITS}〜${MAX_DIGITS}桁です`);
        return;
      }
      if (!s.pin) {
        onUnlock();
        return;
      }
      setBusy(true);
      try {
        const ok = await verifyPin(value, s.pin);
        if (ok) {
          await update({ pinFailures: 0, pinCooldownUntil: undefined });
          onUnlock();
          return;
        }
        const failures = (s.pinFailures ?? 0) + 1;
        setPin('');
        if (failures >= PIN_MAX_FAILURES) {
          const until = Date.now() + PIN_COOLDOWN_MS;
          await update({ pinFailures: 0, pinCooldownUntil: until });
          setNow(Date.now());
          setMessage(`PINが${PIN_MAX_FAILURES}回違いました。しばらくお待ちください`);
        } else {
          await update({ pinFailures: failures });
          setMessage(`PINが違います（あと${PIN_MAX_FAILURES - failures}回まちがえると30秒お待ちいただきます）`);
        }
      } catch (e) {
        ui.toast(isShioriError(e) ? e.messageJa : 'PINを確かめられませんでした', { tone: 'danger' });
      } finally {
        setBusy(false);
      }
    },
    [busy, onUnlock, ui, update, settingsRef],
  );

  const press = useCallback(
    (digit: string) => {
      if (inputDisabled) return;
      setMessage(null);
      setPin((p) => (p.length >= MAX_DIGITS ? p : p + digit));
    },
    [inputDisabled],
  );
  const backspace = useCallback(() => {
    if (inputDisabled) return;
    setPin((p) => p.slice(0, -1));
  }, [inputDisabled]);

  // Physical keyboard: digits, Backspace, Enter.
  useEffect(() => {
    if (forgot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLElement && target.closest('[role="dialog"],[role="alertdialog"]')) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      } else if (e.key === 'Enter') {
        if (target instanceof HTMLButtonElement) return; // let the focused button act
        e.preventDefault();
        void submit(pin);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [forgot, press, backspace, submit, pin]);

  const wipe = async () => {
    const first = await ui.confirm({
      title: '全データを消して初期化しますか？',
      body: '作品・記録・合言葉・おまけなど、この端末のしおり帳のデータがすべて消えます。元に戻せません。',
      okLabel: '次へ',
      danger: true,
    });
    if (!first) return;
    const second = await ui.confirm({
      title: '本当に消しますか？',
      body: '最後の確認です。バックアップファイルがあれば、初期化のあとで読み込めます。',
      okLabel: '消して初期化する',
      danger: true,
    });
    if (second) onWipe();
  };

  if (forgot) {
    return (
      <main className="gate lock" data-shell="lock">
        <div className="gate-card">
          <div className="gate-brand">
            <BrandMark />
            <span>しおり帳</span>
          </div>
          <h1 className="gate-title">PINを忘れた場合</h1>
          <p className="gate-lead">
            PINは端末の中にだけ保存されていて、確かめたり取り出したりする方法はありません。使い続けるには、全データを消して初期化してください。
          </p>
          <p className="banner banner-warn">バックアップファイルを保存していれば、初期化のあとに「設定 → データ」から読み込めます。</p>
          <div className="gate-actions">
            <button type="button" className="btn btn-danger btn-block" onClick={() => void wipe()}>
              全データを消して初期化
            </button>
            <button type="button" className="btn btn-block" onClick={() => setForgot(false)}>
              PINの入力に戻る
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="gate lock" data-shell="lock">
      <div className="gate-card lock-card">
        <div className="lock-top">
          <div className="gate-brand">
            <BrandMark />
            <span>しおり帳</span>
          </div>
          <button type="button" className="btn btn-sm btn-ghost lock-hide" onClick={() => ui.hide()}>
            隠す
          </button>
        </div>
        <h1 className="gate-title lock-title">PINを入力してください</h1>

        <div className="lock-dots" role="img" aria-label={`${pin.length}桁入力済み`}>
          {Array.from({ length: Math.max(MIN_DIGITS, Math.min(MAX_DIGITS, pin.length + (pin.length < MAX_DIGITS ? 1 : 0))) }).map(
            (_, i) => (
              <span key={i} className={`lock-dot${i < pin.length ? ' is-filled' : ''}`} />
            ),
          )}
        </div>

        <p className={`lock-msg${coolingDown || message ? ' is-error' : ''}`} role="status" aria-live="polite">
          {coolingDown ? `あと${secondsLeft}秒お待ちください` : busy ? '確認しています…' : (message ?? ' ')}
        </p>

        <div className="lock-pad" role="group" aria-label="数字キー">
          {KEYS.map((k) => (
            <button key={k} type="button" className="lock-key" disabled={inputDisabled} onClick={() => press(k)}>
              {k}
            </button>
          ))}
          <button type="button" className="lock-key lock-key-sub" disabled={inputDisabled || pin === ''} onClick={backspace} aria-label="1文字消す">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path
                d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM12 9l6 6M18 9l-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="button" className="lock-key" disabled={inputDisabled} onClick={() => press('0')}>
            0
          </button>
          <button
            type="button"
            className="lock-key lock-key-ok"
            disabled={inputDisabled || pin.length < MIN_DIGITS}
            onClick={() => void submit(pin)}
          >
            解除
          </button>
        </div>

        <button type="button" className="btn btn-ghost btn-block lock-forgot" onClick={() => setForgot(true)}>
          PINを忘れた
        </button>
      </div>
    </main>
  );
}
