// #/code?w=<id> 合言葉を入れる (docs/SPEC.md F10, F11 AC2–AC3, §6).
// - CodeInput gives live format feedback; an invalid code (bad checksum, unknown kana word…) is rejected
//   right here with parseCode, before any PBKDF2 runs (F10 AC2).
// - 「確かめる」 runs submitCode (one PBKDF2 per candidate manifest, the chosen / hinted work first).
// - Results follow F10 AC4–AC5: unlocked (decrypted title + unlockMessage, vibrate, envelopes queued),
//   already, no match in the chosen work, no match anywhere (+ 「保留にする」).
// - Pending codes: list with delete (undo) and 「もう一度試す」 (processPending).
// - A one-shot hand-off from the deep-link landing (codeHandoff.ts) pre-fills the result and shows the iOS
//   「コピー → 貼り付け」 notice (F11 AC3).
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isCoarsePointer, vibrate, writeClipboard } from '../../app/platform';
import { addPending, isCodeGoal, loadWorkManifest, processPending, submitCode } from '../../app/unlock';
import { codeErrorMessageJa, displayFromCanonical, parseCode } from '../../core/codes';
import type { GoalSecret, PendingCode, UnlockOutcome, WorkRecord } from '../../core/types';
import type { ShioriRepo } from '../../storage/repo';
import { CodeInput } from '../components/CodeInput';
import { useRepo, useRepoQuery, useSettings, useUi } from '../context';
import { displayTitle, formatDateJa } from '../format';
import { hrefFor } from '../router';
import { clearCodeHandoff, peekCodeHandoff } from './codeHandoff';
import type { CodeHandoff } from './codeHandoff';
import { errorMessageJa } from './libraryShared';
import './CodeEntry.css';

// ───────────────────────── data ─────────────────────────

interface CodeScreenData {
  /** works whose current manifest has code goals (candidates for the selector) */
  targets: WorkRecord[];
  /** oldest first */
  pending: PendingCode[];
}

async function loadCodeScreen(repo: ShioriRepo): Promise<CodeScreenData> {
  const [works, manifests, pending] = await Promise.all([repo.listWorks(), repo.listManifests(), repo.listPending()]);
  const byKey = new Map(manifests.map((m) => [m.key, m.manifest]));
  const targets = works
    .filter((w) => {
      const m = w.manifestKey ? byKey.get(w.manifestKey) : undefined;
      return m !== undefined && m.kdf !== undefined && m.goals.some(isCodeGoal);
    })
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || b.createdAt - a.createdAt);
  return { targets, pending: [...pending].sort((a, b) => a.receivedAt - b.receivedAt) };
}

// ───────────────────────── results ─────────────────────────

interface MatchInfo {
  workId: string;
  work?: WorkRecord;
  goalLabel?: string;
  secret?: GoalSecret;
  opened: number;
}

type Result =
  | ({ kind: 'unlocked' } & MatchInfo)
  | ({ kind: 'already' } & MatchInfo)
  | { kind: 'batch'; items: MatchInfo[] }
  | { kind: 'noMatch'; canonical: string; inWork: boolean; hint?: string }
  | { kind: 'invalid'; message: string };

async function matchInfo(repo: ShioriRepo, outcome: UnlockOutcome): Promise<MatchInfo> {
  const workId = outcome.workId ?? '';
  const wm = workId ? await loadWorkManifest(repo, workId) : undefined;
  const info: MatchInfo = { workId, opened: outcome.openedSealedIds.length };
  const work = wm?.work ?? (workId ? await repo.getWork(workId) : undefined);
  if (work) info.work = work;
  const label = wm?.record.manifest.goals.find((g) => g.id === outcome.goalId)?.label;
  if (label !== undefined) info.goalLabel = label;
  if (outcome.secret) info.secret = outcome.secret;
  return info;
}

/** The result a deep-link hand-off starts with (the code screen shows it as if 「確かめる」 had run). */
function resultFromHandoff(h: CodeHandoff | null): Result | null {
  if (!h) return null;
  const parsed = parseCode(h.code);
  if (h.status === 'invalid' || !parsed.ok) {
    return { kind: 'invalid', message: parsed.ok ? '合言葉を確かめてください' : codeErrorMessageJa(parsed.error) };
  }
  if (h.status === 'noMatch') return { kind: 'noMatch', canonical: parsed.canonical, inWork: false };
  return null;
}

// ───────────────────────── screen ─────────────────────────

export function CodeEntryScreen({ workId }: { workId?: string }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const q = useRepoQuery(loadCodeScreen, []);
  const inputId = useId();
  const selectId = useId();
  const [handoff] = useState(() => peekCodeHandoff());
  const [value, setValue] = useState(() => (handoff && handoff.status !== 'pending' ? handoff.code : ''));
  const [choice, setChoice] = useState(workId ?? '');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [result, setResult] = useState<Result | null>(() => resultFromHandoff(handoff));
  const [iosCode, setIosCode] = useState<string | null>(() =>
    handoff?.ios && handoff.status !== 'invalid' ? handoff.code : null,
  );
  const [pendingNote, setPendingNote] = useState(handoff?.status === 'pending');
  const [autoFocus] = useState(() => !handoff && !isCoarsePointer());

  // The hand-off is read once (peek in the initializers above, then removed).
  useEffect(() => clearCodeHandoff(), []);

  const data = q.data;
  const targets = data?.targets ?? [];
  const chosen = targets.find((w) => w.id === choice);
  const showSelector = targets.length >= 2 || (chosen !== undefined && workId !== undefined);

  const focusInput = () => document.getElementById(inputId)?.focus();

  const onChange = (v: string) => {
    setValue(v);
    if (result && result.kind !== 'unlocked' && result.kind !== 'batch') setResult(null);
  };

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const queueOpened = (outcomes: readonly UnlockOutcome[]) => {
    const items = outcomes.flatMap((o) => (o.workId ? o.openedSealedIds.map((sealedId) => ({ workId: o.workId!, sealedId })) : []));
    if (items.length > 0) ui.queueEnvelopes(items);
  };

  const submit = async () => {
    if (busyRef.current) return;
    const parsed = parseCode(value);
    if (!parsed.ok) {
      // Rejected before any key derivation (F10 AC2). CodeInput may already show the same message.
      const feedback = document.getElementById(`${inputId}-feedback`);
      const shownByInput = feedback?.classList.contains('is-error') === true;
      setResult(shownByInput ? null : { kind: 'invalid', message: codeErrorMessageJa(parsed.error) });
      focusInput();
      return;
    }
    setResult(null);
    await run(async () => {
      const outcome = await submitCode(repo, parsed.canonical, chosen ? { workId: chosen.id } : undefined);
      switch (outcome.status) {
        case 'unlocked':
        case 'already': {
          const info = await matchInfo(repo, outcome);
          if (outcome.status === 'unlocked') vibrate(30);
          queueOpened([outcome]);
          setValue('');
          setResult({ kind: outcome.status, ...info });
          break;
        }
        case 'noMatch': {
          const r: Result = { kind: 'noMatch', canonical: outcome.canonical ?? parsed.canonical, inWork: chosen !== undefined };
          if (chosen?.manifestWorkId) r.hint = chosen.manifestWorkId;
          setResult(r);
          break;
        }
        default:
          setResult({ kind: 'invalid', message: outcome.error ? codeErrorMessageJa(outcome.error) : '合言葉を確かめてください' });
          focusInput();
      }
    });
  };

  const keepPending = async (canonical: string, hint?: string) => {
    const ok = await run(async () => {
      await addPending(repo, canonical, hint);
      return true;
    });
    if (!ok) return;
    ui.toast('保留にしました。しおりファイルを読み込むと、自動で試します', { tone: 'ok' });
    setResult(null);
    setValue('');
  };

  const retryPending = async () => {
    const done = await run(async () => {
      const outcomes = await processPending(repo);
      return { outcomes, items: await Promise.all(outcomes.map((o) => matchInfo(repo, o))) };
    });
    if (!done) return;
    const { outcomes, items } = done;
    if (outcomes.length === 0) {
      ui.toast('まだ一致するしおりがありません');
      return;
    }
    if (outcomes.some((o) => o.status === 'unlocked')) vibrate(30);
    queueOpened(outcomes);
    const first = items[0]!;
    setResult(items.length === 1 ? { kind: outcomes[0]!.status === 'already' ? 'already' : 'unlocked', ...first } : { kind: 'batch', items });
    ui.toast(`${outcomes.length}件の合言葉が通りました`, { tone: 'ok' });
  };

  const removePending = async (p: PendingCode) => {
    try {
      await repo.deletePending(p.id);
      ui.toast('保留中の合言葉を削除しました', {
        action: {
          label: '元に戻す',
          onClick: () => {
            repo.putPending(p).catch((e: unknown) => ui.toast(errorMessageJa(e), { tone: 'danger' }));
          },
        },
      });
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  const workLabel = (w: WorkRecord | undefined) => (w ? displayTitle(w, settings) : '作品');

  return (
    <main className="screen ce">
      <h1 className="ce-title">合言葉を入れる</h1>
      <p className="ce-lead muted">作品の中で見つけた合言葉を入れると、達成の記録がつき、おまけがひらきます。</p>

      {pendingNote ? (
        <Notice icon="🔖" label="保留のお知らせ" onClose={() => setPendingNote(false)}>
          <p>この作品のしおりファイルがまだ読み込まれていないため、合言葉を保留にしました。しおりファイルを読み込むと、自動で試します。</p>
          <div className="ce-note-actions">
            <a className="btn btn-sm" href={hrefFor({ name: 'add' })}>
              しおりファイルを読み込む
            </a>
          </div>
        </Notice>
      ) : null}
      {iosCode !== null ? <IosCopyNotice code={iosCode} onClose={() => setIosCode(null)} /> : null}

      <form
        className="card ce-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={inputId} className="ce-label">
          合言葉
        </label>
        <CodeInput id={inputId} value={value} onChange={onChange} onSubmit={() => void submit()} busy={busy} autoFocus={autoFocus} />

        {showSelector ? (
          <div className="field ce-select">
            <label htmlFor={selectId}>どの作品？（おまかせ）</label>
            <select
              id={selectId}
              className="select"
              value={chosen ? chosen.id : ''}
              disabled={busy}
              onChange={(e) => {
                setChoice(e.target.value);
                if (result?.kind === 'noMatch') setResult(null);
              }}
            >
              <option value="">おまかせ（すべての作品で試す）</option>
              {targets.map((w) => (
                <option key={w.id} value={w.id}>
                  {displayTitle(w, settings)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {result?.kind === 'invalid' ? (
          <p className="field-error ce-invalid" role="alert">
            {result.message}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary btn-block ce-submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? (
            <>
              <span className="ce-spin" aria-hidden="true" />
              <span>確かめています…</span>
            </>
          ) : (
            '確かめる'
          )}
        </button>
      </form>

      <div className="ce-result-slot">
        {result && result.kind !== 'invalid' ? (
          <ResultCard
            result={result}
            workLabel={workLabel}
            busy={busy}
            onKeep={(canonical, hint) => void keepPending(canonical, hint)}
            onRetype={() => {
              setResult(null);
              focusInput();
            }}
          />
        ) : null}
      </div>

      {data && targets.length === 0 && !pendingNote ? (
        <p className="ce-empty small muted">
          合言葉に対応した作品はまだありません。先に作品のしおりファイルを読み込むか、
          <a href={hrefFor({ name: 'settings' })}>設定</a>の「サンプルを試す」でお試しください。合言葉だけ先に入れて保留にすることもできます。
        </p>
      ) : null}

      {data && data.pending.length > 0 ? (
        <section className="ce-pending" aria-labelledby={`${inputId}-pending`}>
          <div className="ce-pending-head">
            <h2 id={`${inputId}-pending`} className="ce-h2">
              保留中の合言葉<span className="badge ce-count">{data.pending.length}件</span>
            </h2>
            <button type="button" className="btn btn-sm" onClick={() => void retryPending()} disabled={busy}>
              もう一度試す
            </button>
          </div>
          <p className="small muted ce-pending-lead">しおりファイルを読み込むと、自動で試します。</p>
          <ul className="ce-pending-list">
            {data.pending.map((p) => {
              const display = displayFromCanonical(p.canonical);
              return (
                <li key={p.id} className="ce-pending-item">
                  <div className="ce-pending-main">
                    <span className="mono ce-pending-code">{display}</span>
                    <span className="small muted">
                      {formatDateJa(p.receivedAt)}に保留
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn ce-pending-del"
                    aria-label={`保留中の合言葉 ${display} を削除`}
                    onClick={() => void removePending(p)}
                    disabled={busy}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
                      <path
                        d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <details className="card-flat ce-where">
        <summary className="ce-where-summary">合言葉はどこにある？</summary>
        <ul className="ce-where-list small">
          <li>ゲームのエンディングやおまけ画面に「しおり帳の合言葉」として表示されます。</li>
          <li>音声作品では最後のトラックで読み上げられたり、台本（PDF）の最後のページに載っていたりします。</li>
          <li>QRコードのときは、スマホのカメラで読み取ると自動で入力されます。</li>
          <li>英数字9文字（例: K7Q-M2X-RAP）か、ひらがな5語です。大文字・小文字や区切りは気にしなくて大丈夫です。</li>
        </ul>
        <p className="small ce-where-more">
          <a href={hrefFor({ name: 'help', section: 'demo-codes' })}>サンプルの合言葉を見る</a>
        </p>
      </details>
    </main>
  );
}

// ───────────────────────── parts ─────────────────────────

function ResultCard({
  result,
  workLabel,
  busy,
  onKeep,
  onRetype,
}: {
  result: Exclude<Result, { kind: 'invalid' }>;
  workLabel(w: WorkRecord | undefined): string;
  busy: boolean;
  onKeep(canonical: string, hint?: string): void;
  onRetype(): void;
}): ReactNode {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  // Move focus to the outcome so it is announced and visible (the card replaces the previous one).
  useEffect(() => {
    headingRef.current?.focus();
  }, [result]);

  if (result.kind === 'unlocked') {
    return (
      <section className="card ce-result is-ok" aria-labelledby={titleId}>
        <p className="ce-result-kicker">
          <span aria-hidden="true">🔓 </span>合言葉が通りました
        </p>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="ce-result-title">
          {result.secret?.title ?? result.goalLabel ?? '達成しました'}
        </h2>
        <p className="ce-result-work small muted">{workLabel(result.work)}</p>
        {result.secret?.unlockMessage ? <p className="ce-result-msg pre">{result.secret.unlockMessage}</p> : null}
        {result.opened > 0 ? <p className="ce-result-extra small">おまけが{result.opened}件ひらきました。</p> : null}
        {result.workId ? (
          <a className="btn btn-primary btn-block" href={hrefFor({ name: 'work', id: result.workId, tab: 'progress' })}>
            作品を見る
          </a>
        ) : null}
      </section>
    );
  }

  if (result.kind === 'already') {
    return (
      <section className="card ce-result" aria-labelledby={titleId}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="ce-result-title">
          この合言葉は入力済みです
        </h2>
        <p className="ce-result-work small muted">
          {[result.secret?.title ?? result.goalLabel, workLabel(result.work)].filter(Boolean).join('・')}
        </p>
        {result.workId ? (
          <a className="btn btn-block" href={hrefFor({ name: 'work', id: result.workId, tab: 'progress' })}>
            作品を見る
          </a>
        ) : null}
      </section>
    );
  }

  if (result.kind === 'batch') {
    return (
      <section className="card ce-result is-ok" aria-labelledby={titleId}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="ce-result-title">
          保留中の合言葉が{result.items.length}件通りました
        </h2>
        <ul className="ce-batch">
          {result.items.map((it, i) => (
            <li key={`${it.workId}-${i}`}>
              <a className="ce-batch-link" href={hrefFor({ name: 'work', id: it.workId, tab: 'progress' })}>
                <span className="ce-batch-title">{it.secret?.title ?? it.goalLabel ?? '達成しました'}</span>
                <span className="small muted">{workLabel(it.work)}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="card ce-result is-warn" aria-labelledby={titleId}>
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className="ce-result-title">
        {result.inWork ? 'この作品の合言葉ではないようです' : '一致するしおりがありません'}
      </h2>
      <p className="small ce-result-body">
        {result.inWork
          ? '入力をもう一度確かめてください。ほかの作品のしおりとも一致しませんでした。'
          : 'しおりファイルをまだ読み込んでいない作品の合言葉かもしれません。保留にすると、しおりファイルを読み込んだときに自動で試します。'}
      </p>
      <div className="ce-result-actions">
        <button type="button" className="btn btn-primary" onClick={() => onKeep(result.canonical, result.hint)} disabled={busy}>
          保留にする
        </button>
        <button type="button" className="btn" onClick={onRetype} disabled={busy}>
          入力しなおす
        </button>
      </div>
    </section>
  );
}

function Notice({
  icon,
  label,
  warn = false,
  onClose,
  children,
}: {
  icon: string;
  label: string;
  warn?: boolean;
  onClose(): void;
  children: ReactNode;
}): ReactNode {
  return (
    <section className={`banner ce-note${warn ? ' banner-warn is-warn' : ''}`} aria-label={label}>
      <span aria-hidden="true" className="ce-note-icon">
        {icon}
      </span>
      <div className="ce-note-body">{children}</div>
      <button type="button" className="icon-btn ce-note-close" aria-label="閉じる" onClick={onClose}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  );
}

function IosCopyNotice({ code, onClose }: { code: string; onClose(): void }): ReactNode {
  const ui = useUi();
  const copy = async () => {
    const ok = await writeClipboard(code);
    ui.toast(ok ? '合言葉をコピーしました' : 'コピーできませんでした。合言葉を長押ししてコピーしてください', {
      tone: ok ? 'ok' : 'danger',
    });
  };
  return (
    <Notice icon="📱" label="ホーム画面のしおり帳で使う場合" warn onClose={onClose}>
      <p>ホーム画面のしおり帳で使う場合：合言葉をコピー → しおり帳の『合言葉』で貼り付け</p>
      <div className="ce-ios-row">
        <span className="mono ce-ios-code">{code}</span>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void copy()}>
          合言葉をコピー
        </button>
      </div>
    </Notice>
  );
}
