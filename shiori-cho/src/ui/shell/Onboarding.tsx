// §6 overlay 2: three short questions (人前で使う？ → aliasOnly, PIN?, 自動ロック), then an explanation of
// 「隠す」 and the long-press return, storage.persist(), and onboardedAt. 「スキップ」 keeps the defaults
// (表示名で隠す, no PIN) and jumps to the explanation.
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { requestPersist } from '../../app/platform';
import { hashPin, isValidPinFormat } from '../../core/crypto/pin';
import { isShioriError } from '../../core/errors';
import type { PinRecord, Settings } from '../../core/types';
import { useSettings, useUi } from '../context';
import { BrandMark } from './BrandMark';
import './gate.css';
import './Onboarding.css';

type Step = 'public' | 'pin' | 'autolock' | 'done';

const QUESTIONS: readonly Step[] = ['public', 'pin', 'autolock'];

const AUTO_LOCK_OPTIONS: ReadonlyArray<{ value: Settings['autoLockSec']; label: string }> = [
  { value: 0, label: 'すぐ' },
  { value: 30, label: '30秒' },
  { value: 60, label: '1分' },
  { value: 300, label: '5分' },
];

export function Onboarding({ onDone }: { onDone(): void }): ReactNode {
  const { settings, update } = useSettings();
  const ui = useUi();
  const [step, setStep] = useState<Step>('public');
  const [aliasOnly, setAliasOnly] = useState(true);
  const [wantPin, setWantPin] = useState(false);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinRecord, setPinRecord] = useState<PinRecord | undefined>(undefined);
  const [autoLockSec, setAutoLockSec] = useState<Settings['autoLockSec']>(settings.autoLockSec);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const ids = { pin1: useId(), pin2: useId(), pinErr: useId(), name: useId() };

  /** 自動ロック is asked only when a PIN was set; the counter always shows the three questions. */
  const steps: Step[] = ['public', 'pin', ...(pinRecord ? (['autolock'] as const) : []), 'done'];
  const questionCount = QUESTIONS.length;
  const index = steps.indexOf(step);
  const questionIndex = QUESTIONS.indexOf(step);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const submitPin = async (e: FormEvent) => {
    e.preventDefault();
    if (!wantPin) {
      setPinRecord(undefined);
      setStep('done');
      return;
    }
    if (!isValidPinFormat(pin1)) {
      setPinError('PINは4〜8桁の数字で入力してください');
      return;
    }
    if (pin1 !== pin2) {
      setPinError('確認用のPINが一致しません');
      return;
    }
    setPinError(null);
    setBusy(true);
    try {
      setPinRecord(await hashPin(pin1));
      setStep('autolock');
    } catch (err) {
      setPinError(isShioriError(err) ? err.messageJa : 'PINを設定できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      const granted = await requestPersist();
      const now = Date.now();
      await update({
        discreet: { ...settings.discreet, aliasOnly },
        ...(pinRecord ? { pin: pinRecord, autoLockSec, pinFailures: 0 } : {}),
        persist: { requestedAt: now, granted },
        onboardedAt: now,
      });
      onDone();
    } catch (err) {
      ui.toast(isShioriError(err) ? err.messageJa : '設定を保存できませんでした', { tone: 'danger' });
      setBusy(false);
    }
  };

  const back = () => {
    const prev = steps[index - 1];
    if (prev) setStep(prev);
  };

  return (
    <main className="gate ob" data-shell="onboarding">
      <div className="gate-card">
        <div className="ob-top">
          <div className="gate-brand">
            <BrandMark />
            <span>しおり帳</span>
          </div>
          {step !== 'done' ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('done')}>
              スキップ
            </button>
          ) : null}
        </div>

        {step !== 'done' ? (
          <p className="ob-count" aria-label={`質問 ${questionIndex + 1} / ${questionCount}`}>
            {QUESTIONS.map((q, i) => (
              <span key={q} className={`ob-dot${i <= questionIndex ? ' is-on' : ''}`} aria-hidden="true" />
            ))}
            <span aria-hidden="true">
              {questionIndex + 1} / {questionCount}
            </span>
          </p>
        ) : null}

        {step === 'public' ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              setStep('pin');
            }}
          >
            <h1 ref={headingRef} tabIndex={-1} className="gate-title">
              人前で使うことがありますか？
            </h1>
            <p className="gate-lead ob-lead">「はい」にすると、一覧や見出しで作品名のかわりに「作品A」のような表示名を使います。</p>
            <fieldset className="ob-options">
              <legend className="visually-hidden">人前で使うことがありますか？</legend>
              <Option name={ids.name} checked={aliasOnly} onSelect={() => setAliasOnly(true)} title="はい" sub="表示名で隠す（おすすめ）" />
              <Option name={ids.name} checked={!aliasOnly} onSelect={() => setAliasOnly(false)} title="いいえ" sub="作品名をそのまま表示する" />
            </fieldset>
            <div className="gate-actions">
              <button type="submit" className="btn btn-primary btn-block">
                次へ
              </button>
            </div>
          </form>
        ) : null}

        {step === 'pin' ? (
          <form className="stack" onSubmit={(e) => void submitPin(e)} noValidate>
            <h1 ref={headingRef} tabIndex={-1} className="gate-title">
              PINを設定しますか？
            </h1>
            <p className="gate-lead ob-lead">開くときに4〜8桁の数字を求めます。画面ロックです。保存データそのものは暗号化されません。</p>
            <fieldset className="ob-options">
              <legend className="visually-hidden">PINを設定しますか？</legend>
              <Option name={`${ids.name}-pin`} checked={!wantPin} onSelect={() => setWantPin(false)} title="設定しない" sub="あとで設定から変えられます" />
              <Option name={`${ids.name}-pin`} checked={wantPin} onSelect={() => setWantPin(true)} title="設定する" sub="PINを忘れると、データを消して初期化するしかありません" />
            </fieldset>
            {wantPin ? (
              <div className="stack-sm">
                <div className="field">
                  <label htmlFor={ids.pin1}>PIN（4〜8桁の数字）</label>
                  <input
                    id={ids.pin1}
                    className="input ob-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={8}
                    value={pin1}
                    aria-invalid={pinError ? 'true' : undefined}
                    aria-describedby={pinError ? ids.pinErr : undefined}
                    onChange={(e) => setPin1(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  />
                </div>
                <div className="field">
                  <label htmlFor={ids.pin2}>もう一度入力</label>
                  <input
                    id={ids.pin2}
                    className="input ob-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={8}
                    value={pin2}
                    aria-invalid={pinError ? 'true' : undefined}
                    aria-describedby={pinError ? ids.pinErr : undefined}
                    onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  />
                </div>
                {pinError ? (
                  <p id={ids.pinErr} className="field-error" role="alert">
                    {pinError}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="gate-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                {busy ? '設定しています…' : wantPin ? 'PINを設定して次へ' : '次へ'}
              </button>
              <button type="button" className="btn btn-ghost btn-block" onClick={back} disabled={busy}>
                戻る
              </button>
            </div>
          </form>
        ) : null}

        {step === 'autolock' ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              setStep('done');
            }}
          >
            <h1 ref={headingRef} tabIndex={-1} className="gate-title">
              自動ロックまでの時間
            </h1>
            <p className="gate-lead ob-lead">アプリから離れてこの時間がたつと、戻ったときにPINを求めます。</p>
            <fieldset className="ob-options ob-options-grid">
              <legend className="visually-hidden">自動ロックまでの時間</legend>
              {AUTO_LOCK_OPTIONS.map((o) => (
                <Option
                  key={o.value}
                  name={`${ids.name}-lock`}
                  checked={autoLockSec === o.value}
                  onSelect={() => setAutoLockSec(o.value)}
                  title={o.label}
                />
              ))}
            </fieldset>
            <div className="gate-actions">
              <button type="submit" className="btn btn-primary btn-block">
                次へ
              </button>
              <button type="button" className="btn btn-ghost btn-block" onClick={back}>
                戻る
              </button>
            </div>
          </form>
        ) : null}

        {step === 'done' ? (
          <div className="stack">
            <h1 ref={headingRef} tabIndex={-1} className="gate-title">
              すぐに隠せます
            </h1>
            <div className="ob-demo" aria-hidden="true">
              <div className="ob-demo-screen">
                <span className="ob-demo-bar">
                  <span>しおり帳</span>
                  <span className="ob-demo-hide">隠す</span>
                </span>
                <span className="ob-demo-lines" />
              </div>
              <span className="ob-demo-arrow">→</span>
              <div className="ob-demo-screen is-memo">
                <span className="ob-demo-memo">メモ</span>
                <span className="ob-demo-lines" />
              </div>
            </div>
            <ul className="ob-list">
              <li>画面上の「隠す」（パソコンでは Esc キー）を押すと、すぐに無地の「メモ」画面に切り替わります。</li>
              <li>
                戻るときは「メモ」の見出しを<strong>1秒ほど長押し</strong>してください。
                {pinRecord ? '続けてPINを入力します。' : ''}
              </li>
              <li>記録はこの端末の中だけに保存されます。消えにくくするため、ブラウザに保存の許可を求めることがあります。</li>
            </ul>
            <div className="gate-actions">
              <button type="button" className="btn btn-primary btn-block" onClick={() => void finish()} disabled={busy}>
                {busy ? '準備しています…' : 'はじめる'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Option({
  name,
  checked,
  onSelect,
  title,
  sub,
}: {
  name: string;
  checked: boolean;
  onSelect(): void;
  title: string;
  sub?: string;
}): ReactNode {
  return (
    <label className={`ob-option${checked ? ' is-checked' : ''}`}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} />
      <span className="ob-option-text">
        <span className="ob-option-title">{title}</span>
        {sub ? <span className="ob-option-sub">{sub}</span> : null}
      </span>
    </label>
  );
}
