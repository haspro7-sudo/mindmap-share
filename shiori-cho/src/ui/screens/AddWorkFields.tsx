// Form parts shared by かんたんしおり (QuickPackForm) and 記録だけ付ける (ManualWorkForm): title, alias,
// kind and store code (docs/SPEC.md F4 AC1).
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { WORK_ALIAS_MAX, WORK_TITLE_MAX } from '../../app/library';
import type { WorkKind } from '../../core/types';
import { KIND_LABEL, KIND_ORDER } from '../format';
import type { WorkBasics, WorkBasicsErrors } from './libraryShared';
import './AddWork.css';

export interface WorkBasicsFieldsProps {
  idPrefix: string;
  value: WorkBasics;
  onChange(next: WorkBasics): void;
  errors: WorkBasicsErrors;
  /** called when the store code field loses focus (to show its inline error) */
  onStoreCodeBlur?(): void;
  aliasPlaceholder?: string;
}

export function WorkBasicsFields({
  idPrefix,
  value,
  onChange,
  errors,
  onStoreCodeBlur,
  aliasPlaceholder,
}: WorkBasicsFieldsProps): ReactNode {
  const set = <K extends keyof WorkBasics>(key: K, v: WorkBasics[K]) => onChange({ ...value, [key]: v });
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <>
      <div className="field">
        <label htmlFor={id('title')}>
          タイトル<span className="aw-req">必須</span>
        </label>
        <input
          id={id('title')}
          className="input"
          value={value.title}
          onChange={(e) => set('title', e.target.value)}
          maxLength={WORK_TITLE_MAX}
          autoComplete="off"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? id('title-error') : id('title-hint')}
        />
        {errors.title ? (
          <p id={id('title-error')} className="field-error aw-error" role="alert">
            {errors.title}
          </p>
        ) : (
          <p id={id('title-hint')} className="field-hint">
            おしのびモードでは、一覧などに表示名だけが出ます。
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor={id('alias')}>
          表示名<span className="aw-opt">任意</span>
        </label>
        <input
          id={id('alias')}
          className="input"
          value={value.alias}
          onChange={(e) => set('alias', e.target.value)}
          maxLength={WORK_ALIAS_MAX}
          placeholder={aliasPlaceholder}
          autoComplete="off"
          aria-describedby={id('alias-hint')}
        />
        <p id={id('alias-hint')} className="field-hint">
          空欄なら「{aliasPlaceholder ?? '作品A'}」のような名前になります。
        </p>
      </div>

      <KindField idPrefix={idPrefix} value={value.kind} onChange={(k) => set('kind', k)} />

      <div className="field">
        <label htmlFor={id('store')}>
          作品コード<span className="aw-opt">任意</span>
        </label>
        <input
          id={id('store')}
          className="input aw-store"
          value={value.storeCode}
          onChange={(e) => set('storeCode', e.target.value)}
          onBlur={onStoreCodeBlur}
          placeholder="例: RJ01234567"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          aria-invalid={errors.storeCode ? true : undefined}
          aria-describedby={errors.storeCode ? id('store-error') : id('store-hint')}
        />
        {errors.storeCode ? (
          <p id={id('store-error')} className="field-error aw-error" role="alert">
            {errors.storeCode}
          </p>
        ) : (
          <p id={id('store-hint')} className="field-hint">
            RJ・VJ・BJで始まるコードです。全角や小文字でも大丈夫です。
          </p>
        )}
      </div>
    </>
  );
}

export function KindField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: WorkKind;
  onChange(k: WorkKind): void;
}): ReactNode {
  return (
    <fieldset className="aw-fieldset">
      <legend className="field-label">種類</legend>
      <div className="aw-radios">
        {KIND_ORDER.map((k) => (
          <label key={k} className="aw-radio">
            <input
              type="radio"
              name={`${idPrefix}-kind`}
              value={k}
              checked={value === k}
              onChange={() => onChange(k)}
            />
            <span className="aw-radio-face">{KIND_LABEL[k]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Heading that takes focus when a sub-view opens (so screen readers and keyboards start there).
 * `autoFocus={false}` skips it (e.g. the menu on first load, where focus should stay at the top).
 */
export function FocusHeading({
  children,
  className,
  id,
  autoFocus = true,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  autoFocus?: boolean;
}): ReactNode {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <h1 ref={ref} id={id} tabIndex={-1} className={className ? `aw-heading ${className}` : 'aw-heading'}>
      {children}
    </h1>
  );
}
