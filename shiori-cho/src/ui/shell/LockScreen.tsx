// F3: PIN pad (buttons and the keyboard), verifyPin, failure counter in settings.pinFailures; after 5 wrong
// PINs a 30 s cooldown is stored in pinCooldownUntil (survives reloads) and counted down on screen; success
// resets both (shared with 設定 → 画面ロック through ./pinThrottle; a cooldown stored under a clock that was
// ahead is clamped to 30 s). 「PINを忘れた」 explains that the only way out is 全データを消して初期化
// (double confirm → onWipe). The PIN guards the whole app, so that wipe also deletes the サークル工房 data —
// keeping it would hand the creator's secrets to whoever does the wipe — and the copy says so.
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { PIN_MAX_FAILURES } from '../../core/constants';
import { isShioriError } from '../../core/errors';
import { useLatest } from '../components/useLatest';
import { useSettings, useUi } from '../context';
import { BrandMark } from './BrandMark';
import { checkPinThrottled, cooldownUntil as effectiveCooldownUntil, normalizedCooldownPatch } from './pinThrottle';
import './gate.css';
import './LockScreen.css';

const MAX_DIGITS = 8;
const MIN_DIGITS = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** What 全データを消して初期化 deletes (both confirmations and the 「PINを忘れた」 page say the same). */
export const WIPE_SCOPE_JA = '本棚・進捗・記録・メモ・合言葉・おまけ・設定と、サークル工房のプロジェクト';

export interface LockScreenProps {
  onUnlock(): void;
  /**
   * 「PINを忘れた」 → 全データを消して初期化 (after the double confirmation). Deletes everything (player and
   * studio data) and restarts the app; a rejected promise is shown on the page.
   */
  onWipe(): Promise<void> | void;
}

export function LockScreen({ onUnlock, onWipe }: LockScreenProps): ReactNode {
  const { settings, update } = useSettings();
  const ui = useUi();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [forgot, setForgot] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);
  const settingsRef = useLatest(settings);

  const cooldownUntil = effectiveCooldownUntil(settings, now);
  const coolingDown = cooldownUntil > now;
  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const inputDisabled = busy || coolingDown;

  // A cooldown stored while the clock was ahead: store it as a normal 30 s cooldown from now.
  const storedCooldown = settings.pinCooldownUntil;
  useEffect(() => {
    const patch = normalizedCooldownPatch({ pinCooldownUntil: storedCooldown });
    if (patch) update(patch).catch((e: unknown) => console.error('[shiori] could not save', e));
  }, [storedCooldown, update]);

  // Tick once per second while a cooldown is running.
  useEffect(() => {
    if (!coolingDown) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [coolingDown]);

  const submit = useCallback(
    async (value: string) => {
      const s = settingsRef.current;
      if (busy || effectiveCooldownUntil(s) > Date.now()) return;
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
        const r = await checkPinThrottled(value, s, update);
        if (r.status === 'ok') {
          onUnlock();
          return;
        }
        setPin('');
        setNow(Date.now());
        if (r.status === 'cooldown') {
          if (r.started) setMessage(`PINが${PIN_MAX_FAILURES}回違いました。しばらくお待ちください`);
        } else {
          setMessage(`PINが違います（あと${r.left}回まちがえると30秒お待ちいただきます）`);
        }
      } catch (e) {
        ui.toast(isShioriError(e) ? e.messageJa : 'PINを確かめられませんでした', { tone: 'danger', whileSuspended: true });
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
    if (wiping) return;
    const first = await ui.confirm({
      title: '全データを消して初期化しますか？',
      body: `${WIPE_SCOPE_JA}が、この端末からすべて消えます。元に戻せません。`,
      okLabel: '次へ',
      danger: true,
      whileSuspended: true,
    });
    if (!first) return;
    const second = await ui.confirm({
      title: '本当に消しますか？',
      body: '最後の確認です。バックアップファイルやサークル工房の控えがあれば、初期化のあとで読み込めます。',
      okLabel: '消して初期化する',
      danger: true,
      whileSuspended: true,
    });
    if (!second) return;
    setWipeError(null);
    setWiping(true);
    try {
      await onWipe();
    } catch (e) {
      console.error('[shiori] could not delete the data', e);
      setWipeError(
        isShioriError(e)
          ? e.messageJa
          : 'データを消せませんでした。ほかのタブやウィンドウでしおり帳を開いている場合は閉じてから、もう一度お試しください。',
      );
      setWiping(false);
    }
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
            PINそのものは保存されておらず（確かめるための値だけが端末にあります）、確かめたり取り出したりする方法はありません。使い続けるには、全データを消して初期化してください。
          </p>
          <p className="gate-lead">初期化すると、{WIPE_SCOPE_JA}がすべて消えます。</p>
          <p className="banner banner-warn">
            バックアップファイルを保存していれば、初期化のあとに「設定 → データ」から読み込めます。サークル工房のプロジェクトは、書き出した控えから読み込みなおせます。
          </p>
          {wipeError ? (
            <p className="field-error lock-wipe-error" role="alert">
              {wipeError}
            </p>
          ) : null}
          <div className="gate-actions">
            <button type="button" className="btn btn-danger btn-block" onClick={() => void wipe()} disabled={wiping} aria-busy={wiping || undefined}>
              {wiping ? '消しています…' : '全データを消して初期化'}
            </button>
            <button type="button" className="btn btn-block" onClick={() => setForgot(false)} disabled={wiping}>
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
