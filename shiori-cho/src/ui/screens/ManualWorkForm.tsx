// 記録だけ付ける (docs/SPEC.md F4 AC1): a work without a shiori file, created with createWork.
import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createWork, defaultCoverEmoji } from '../../app/library';
import type { CoverColor } from '../../core/types';
import { EmojiCover } from '../components/EmojiCover';
import { useRepo, useSettings, useUi } from '../context';
import { COVER_COLORS, COVER_EMOJIS, coverColorVar } from '../format';
import { navigate } from '../router';
import { FocusHeading, WorkBasicsFields } from './AddWorkFields';
import { errorMessageJa, focusFirst, useNextAlias, validateWorkBasics } from './libraryShared';
import type { WorkBasics, WorkBasicsErrors } from './libraryShared';
import './AddWork.css';

export interface ManualWorkFormProps {
  /** 「やめる」: back to the 作品を追加 menu */
  onCancel(): void;
}

const COLOR_LABEL: Record<CoverColor, string> = {
  paper: '生成り',
  sky: '空色',
  leaf: '若葉色',
  sun: '山吹色',
  rose: '桜色',
  plum: '藤色',
  slate: '灰色',
};

const ID = 'mw';

export function ManualWorkForm({ onCancel }: ManualWorkFormProps): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const aliasPlaceholder = useNextAlias();
  const [basics, setBasics] = useState<WorkBasics>({ title: '', alias: '', kind: 'game', storeCode: '' });
  /** undefined = follow the kind's default emoji */
  const [emoji, setEmoji] = useState<string | undefined>(undefined);
  const [color, setColor] = useState<CoverColor>('paper');
  const [submitted, setSubmitted] = useState(false);
  const [storeTouched, setStoreTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const coverEmoji = emoji ?? defaultCoverEmoji(basics.kind);
  const fieldErrors = validateWorkBasics(basics);
  const shownErrors: WorkBasicsErrors = {};
  if (submitted && fieldErrors.title) shownErrors.title = fieldErrors.title;
  if ((submitted || storeTouched) && fieldErrors.storeCode) shownErrors.storeCode = fieldErrors.storeCode;

  const previewName =
    settings.discreet.aliasOnly || basics.title.trim() === ''
      ? basics.alias.trim() || aliasPlaceholder || '作品'
      : basics.title.trim();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    setSubmitted(true);
    if (fieldErrors.title || fieldErrors.storeCode) {
      const ids: string[] = [];
      if (fieldErrors.title) ids.push(`${ID}-title`);
      if (fieldErrors.storeCode) ids.push(`${ID}-store`);
      focusFirst(ids);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const input: Parameters<typeof createWork>[1] = {
        title: basics.title,
        kind: basics.kind,
        coverEmoji,
        coverColor: color,
      };
      if (basics.alias.trim() !== '') input.alias = basics.alias;
      if (basics.storeCode.trim() !== '') input.storeCode = basics.storeCode;
      const work = await createWork(repo, input);
      ui.toast('本棚に追加しました', { tone: 'ok' });
      navigate({ name: 'work', id: work.id, tab: 'progress' }, { replace: true });
    } catch (err) {
      ui.toast(errorMessageJa(err), { tone: 'danger' });
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <form className="aw-form stack" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby={`${ID}-heading`}>
      <div className="aw-form-head">
        <FocusHeading id={`${ID}-heading`}>記録だけ付ける</FocusHeading>
        <p className="muted small aw-lead">
          しおりファイルがなくても、プレイ記録・前回の続き・メモを残せます。
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

      <section className="card-flat stack" aria-labelledby={`${ID}-cover-title`}>
        <div className="aw-cover-head">
          <h2 id={`${ID}-cover-title`} className="aw-section-title">
            アイコン
          </h2>
          <div className="aw-cover-preview" aria-hidden="true">
            <EmojiCover emoji={coverEmoji} color={color} size={48} />
            <span className="aw-cover-name">{previewName}</span>
          </div>
        </div>

        <fieldset className="aw-fieldset">
          <legend className="field-label">絵文字</legend>
          <div className="aw-emojis">
            {COVER_EMOJIS.map((em) => (
              <label key={em} className="aw-swatch aw-emoji">
                <input
                  type="radio"
                  name={`${ID}-emoji`}
                  value={em}
                  checked={coverEmoji === em}
                  onChange={() => setEmoji(em)}
                  aria-label={`絵文字 ${em}`}
                />
                <span className="aw-swatch-face" aria-hidden="true">
                  {em}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="aw-fieldset">
          <legend className="field-label">色</legend>
          <div className="aw-colors">
            {COVER_COLORS.map((c) => (
              <label key={c} className="aw-swatch aw-color">
                <input
                  type="radio"
                  name={`${ID}-color`}
                  value={c}
                  checked={color === c}
                  onChange={() => setColor(c)}
                  aria-label={COLOR_LABEL[c]}
                />
                <span className="aw-swatch-face" aria-hidden="true" style={{ background: coverColorVar(c) }} />
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <div className="aw-actions">
        <button type="button" className="btn" onClick={onCancel}>
          やめる
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          追加する
        </button>
      </div>
    </form>
  );
}
