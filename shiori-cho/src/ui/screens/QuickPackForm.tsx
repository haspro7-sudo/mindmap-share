// かんたんしおり (docs/SPEC.md F6 AC1–AC2): counts → a player-authored checklist, created with createQuickWork.
import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createQuickWork } from '../../app/library';
import { isShioriError } from '../../core/errors';
import { QUICK_LABELS, QUICK_LIMITS, checkQuickCounts } from '../../core/manifest/quick';
import type { QuickCounts } from '../../core/types';
import { useRepo, useUi } from '../context';
import { navigate } from '../router';
import { leaveLayersThen } from './work/historyLayer';
import { FocusHeading, WorkBasicsFields } from './AddWorkFields';
import { errorMessageJa, focusFirst, useNextAlias, validateWorkBasics } from './libraryShared';
import type { WorkBasics, WorkBasicsErrors } from './libraryShared';
import './AddWork.css';

export interface QuickPackFormProps {
  /** 「やめる」: back to the 作品を追加 menu */
  onCancel(): void;
}

const COUNT_KEYS: ReadonlyArray<keyof QuickCounts> = ['endings', 'cg', 'achievements', 'tracks', 'chapters'];
const COUNT_HINTS: Partial<Record<keyof QuickCounts, string>> = {
  chapters: '現在地の記録に使います',
};

type CountTexts = Record<keyof QuickCounts, string>;

const ID = 'qp';

function toCount(s: string): number {
  const t = s.normalize('NFKC').trim();
  return t === '' ? 0 : Number(t);
}

function toCounts(texts: CountTexts): QuickCounts {
  return {
    endings: toCount(texts.endings),
    cg: toCount(texts.cg),
    achievements: toCount(texts.achievements),
    tracks: toCount(texts.tracks),
    chapters: toCount(texts.chapters),
  };
}

/** The Japanese reason the counts cannot make a quick shiori, or null when they can (F6 AC1). */
function countsError(counts: QuickCounts): string | null {
  try {
    checkQuickCounts(counts);
    return null;
  } catch (e) {
    return isShioriError(e) ? e.messageJa : 'エンディング・CG・実績・トラックのどれかを1以上にしてください';
  }
}

export function QuickPackForm({ onCancel }: QuickPackFormProps): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const aliasPlaceholder = useNextAlias();
  const [basics, setBasics] = useState<WorkBasics>({ title: '', alias: '', kind: 'game', storeCode: '' });
  const [texts, setTexts] = useState<CountTexts>({ endings: '0', cg: '0', achievements: '0', tracks: '0', chapters: '0' });
  const [submitted, setSubmitted] = useState(false);
  const [storeTouched, setStoreTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const counts = toCounts(texts);
  const fieldErrors = validateWorkBasics(basics);
  const shownErrors: WorkBasicsErrors = {};
  if (submitted && fieldErrors.title) shownErrors.title = fieldErrors.title;
  if ((submitted || storeTouched) && fieldErrors.storeCode) shownErrors.storeCode = fieldErrors.storeCode;
  const countErr = countsError(counts);
  const goalTotal = [counts.endings, counts.cg, counts.achievements, counts.tracks].reduce(
    (a, b) => a + (Number.isInteger(b) && b > 0 ? b : 0),
    0,
  );

  const setCount = (key: keyof QuickCounts, text: string) => setTexts((t) => ({ ...t, [key]: text }));
  const step = (key: keyof QuickCounts, delta: number) => {
    const cur = toCount(texts[key]);
    const base = Number.isInteger(cur) ? cur : 0;
    setCount(key, String(Math.min(QUICK_LIMITS[key], Math.max(0, base + delta))));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    setSubmitted(true);
    if (fieldErrors.title || fieldErrors.storeCode || countErr) {
      const ids: string[] = [];
      if (fieldErrors.title) ids.push(`${ID}-title`);
      if (fieldErrors.storeCode) ids.push(`${ID}-store`);
      if (countErr) ids.push(`${ID}-count-${COUNT_KEYS.find((k) => !Number.isInteger(counts[k]) || counts[k] < 0 || counts[k] > QUICK_LIMITS[k]) ?? 'endings'}`);
      focusFirst(ids);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const input: Parameters<typeof createQuickWork>[1] = { title: basics.title, kind: basics.kind, counts };
      if (basics.alias.trim() !== '') input.alias = basics.alias;
      if (basics.storeCode.trim() !== '') input.storeCode = basics.storeCode;
      const work = await createQuickWork(repo, input);
      ui.toast('かんたんしおりを作りました', { tone: 'ok' });
      // #/add's sub-view is a history layer: leave it first so the replace takes #/add's own entry.
      leaveLayersThen(() => navigate({ name: 'work', id: work.id, tab: 'progress' }, { replace: true }));
    } catch (err) {
      ui.toast(errorMessageJa(err), { tone: 'danger' });
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <form className="aw-form stack" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby={`${ID}-heading`}>
      <div className="aw-form-head">
        <FocusHeading id={`${ID}-heading`}>かんたんしおりを作る</FocusHeading>
        <p className="muted small aw-lead">
          エンディングやCGの数を入れるだけで、チェックリストを作ります。項目名はあとから変えられます。
        </p>
      </div>

      <section className="card-flat stack">
        <WorkBasicsFields
          idPrefix={ID}
          value={basics}
          onChange={setBasics}
          errors={shownErrors}
          onStoreCodeBlur={() => setStoreTouched(true)}
          aliasPlaceholder={aliasPlaceholder}
        />
      </section>

      <section className="card-flat aw-counts" aria-labelledby={`${ID}-counts-title`}>
        <h2 id={`${ID}-counts-title`} className="aw-section-title">
          項目の数
        </h2>
        <p className="field-hint aw-counts-hint">わかる分だけで大丈夫です。0の項目は作りません。</p>
        <div className="aw-count-list">
          {COUNT_KEYS.map((key) => {
            const label = QUICK_LABELS[key];
            const max = QUICK_LIMITS[key];
            const n = counts[key];
            const inputId = `${ID}-count-${key}`;
            const hintId = `${inputId}-hint`;
            return (
              <div key={key} className="aw-count-row">
                <div className="aw-count-label">
                  <label htmlFor={inputId}>{label}</label>
                  <span id={hintId} className="field-hint">
                    0〜{max}
                    {COUNT_HINTS[key] ? `・${COUNT_HINTS[key]}` : ''}
                  </span>
                </div>
                <div className="aw-stepper">
                  <button
                    type="button"
                    className="btn aw-step"
                    onClick={() => step(key, -1)}
                    disabled={Number.isInteger(n) && n <= 0}
                    aria-label={`${label}を1つ減らす`}
                  >
                    −
                  </button>
                  <input
                    id={inputId}
                    className="input aw-count-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={texts[key]}
                    onChange={(e) => setCount(key, e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-describedby={hintId}
                    aria-invalid={submitted && countErr !== null && (!Number.isInteger(n) || n < 0 || n > max) ? true : undefined}
                  />
                  <button
                    type="button"
                    className="btn aw-step"
                    onClick={() => step(key, 1)}
                    disabled={Number.isInteger(n) && n >= max}
                    aria-label={`${label}を1つ増やす`}
                  >
                    ＋
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="aw-count-total" aria-live="polite">
          {goalTotal > 0 ? `チェック項目 ${goalTotal}個` : 'チェック項目はまだありません'}
          {Number.isInteger(counts.chapters) && counts.chapters > 0 ? `・章 ${counts.chapters}` : ''}
        </p>
        {submitted && countErr ? (
          <p className="field-error aw-error" role="alert">
            {countErr}
          </p>
        ) : null}
      </section>

      <div className="aw-actions">
        <button type="button" className="btn" onClick={onCancel}>
          やめる
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          作成する
        </button>
      </div>
    </form>
  );
}
