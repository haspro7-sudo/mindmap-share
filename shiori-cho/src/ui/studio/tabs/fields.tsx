// Small form building blocks of the サークル工房 editor: labelled text fields with a 公開/秘密 marker and a
// character counter, an id field that commits on blur, reorder/delete buttons and inline issue lists.
import { useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ValidationIssue } from '../../../core/types';

export type Visibility = 'public' | 'secret';

export function VisibilityBadge({ kind }: { kind: Visibility }): ReactNode {
  return kind === 'public' ? (
    <span className="badge badge-warn stu-vis" title="しおりファイルを開けば誰でも読めます">
      公開
    </span>
  ) : (
    <span className="badge badge-ok stu-vis" title="合言葉を入れるまで暗号化されます">
      <span aria-hidden="true">🔒</span>秘密
    </span>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange(value: string): void;
  onBlur?(): void;
  maxLength?: number;
  hint?: ReactNode;
  error?: string | null;
  /** a non-blocking note shown in the warning color */
  warning?: string | null;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  visibility?: Visibility;
  placeholder?: string;
  type?: 'text' | 'url' | 'date';
  inputMode?: 'text' | 'url' | 'numeric' | 'latin';
  mono?: boolean;
  /** the input's id (for tests / focusing); generated when absent */
  id?: string;
  className?: string;
}

export function TextField(props: TextFieldProps): ReactNode {
  const {
    label,
    value,
    onChange,
    onBlur,
    maxLength,
    hint,
    error,
    warning,
    required = false,
    multiline = false,
    rows = 4,
    visibility,
    placeholder,
    type = 'text',
    inputMode,
    mono = false,
    className,
  } = props;
  const autoId = useId();
  const id = props.id ?? autoId;
  const hintId = `${id}-hint`;
  const msgId = `${id}-msg`;
  const describedBy = [hint ? hintId : null, error || warning ? msgId : null].filter(Boolean).join(' ') || undefined;
  const common = {
    id,
    value,
    maxLength,
    placeholder,
    required,
    'aria-invalid': error ? ('true' as const) : undefined,
    'aria-describedby': describedBy,
    onBlur,
    spellCheck: false,
    autoComplete: 'off',
  };
  return (
    <div className={`field stu-field${className ? ` ${className}` : ''}`}>
      <div className="stu-field-head">
        <label htmlFor={id}>
          {label}
          {required ? <span className="stu-req">（必須）</span> : null}
        </label>
        {visibility ? <VisibilityBadge kind={visibility} /> : null}
        {maxLength !== undefined ? (
          <span className={`stu-count${value.length > maxLength * 0.9 ? ' is-near' : ''}`} aria-hidden="true">
            {value.length}/{maxLength}
          </span>
        ) : null}
      </div>
      {multiline ? (
        <textarea {...common} className={`textarea${mono ? ' mono' : ''}`} rows={rows} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          {...common}
          className={`input${mono ? ' mono' : ''}`}
          type={type}
          inputMode={inputMode === 'latin' ? 'text' : inputMode}
          autoCapitalize={inputMode === 'latin' || inputMode === 'url' ? 'off' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={msgId} className="field-error">
          {error}
        </p>
      ) : warning ? (
        <p id={msgId} className="stu-field-warn">
          {warning}
        </p>
      ) : null}
    </div>
  );
}

export interface SelectFieldProps<T extends string> {
  label: string;
  value: T | '';
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T | ''): void;
  /** label of an extra empty option (e.g. 「指定しない」) */
  emptyLabel?: string;
  hint?: ReactNode;
  error?: string | null;
  visibility?: Visibility;
}

export function SelectField<T extends string>(props: SelectFieldProps<T>): ReactNode {
  const { label, value, options, onChange, emptyLabel, hint, error, visibility } = props;
  const id = useId();
  const known = value === '' || options.some((o) => o.value === value);
  return (
    <div className="field stu-field">
      <div className="stu-field-head">
        <label htmlFor={id}>{label}</label>
        {visibility ? <VisibilityBadge kind={visibility} /> : null}
      </div>
      <select
        id={id}
        className="select"
        value={value}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value as T | '')}
      >
        {emptyLabel !== undefined || !known ? <option value="">{emptyLabel ?? '選んでください'}</option> : null}
        {!known ? (
          <option value={value} disabled>
            {`（見つかりません：${value}）`}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint || error ? (
        <div id={`${id}-hint`}>
          {hint ? <p className="field-hint">{hint}</p> : null}
          {error ? <p className="field-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export interface IdFieldProps {
  label: string;
  value: string;
  /** returns a Japanese error for an unacceptable id, or null */
  validate(next: string): string | null;
  /** called on blur / Enter with a new, valid id */
  onCommit(next: string): void;
  hint?: ReactNode;
  /** extra problem reported by the project lint (e.g. duplicate id in an imported file) */
  issue?: string | null;
  compact?: boolean;
}

/**
 * An id input that edits locally and commits on blur or Enter, so references are renamed once (not on every
 * keystroke) and a half-typed id never collides with another item. Escape restores the stored id.
 */
export function IdField({ label, value, validate, onCommit, hint, issue, compact = false }: IdFieldProps): ReactNode {
  const id = useId();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(value);
  // The stored id changed (commit, rename elsewhere, reorder): show it and drop the local edit.
  if (shown !== value) {
    setShown(value);
    setText(value);
    setError(null);
  }

  const commit = () => {
    const next = text.trim();
    if (next === value) {
      setText(value);
      setError(null);
      return;
    }
    const err = validate(next);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape' && text !== value) {
      e.preventDefault();
      e.stopPropagation();
      setText(value);
      setError(null);
    }
  };

  const message = error ?? issue ?? null;
  return (
    <div className={`field stu-field${compact ? ' stu-field-compact' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input mono stu-id-input"
        value={text}
        maxLength={40}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        inputMode="text"
        aria-invalid={message ? 'true' : undefined}
        aria-describedby={hint || message ? `${id}-msg` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {hint || message ? (
        <div id={`${id}-msg`}>
          {hint ? <p className="field-hint">{hint}</p> : null}
          {message ? <p className="field-error">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export interface ItemToolsProps {
  /** name of the item for the accessible labels, e.g. 「『第1章』」 */
  name: string;
  index: number;
  count: number;
  onMove(delta: -1 | 1): void;
  onDelete?(): void;
}

/** ↑ / ↓ / 削除 buttons of a list item. */
export function ItemTools({ name, index, count, onMove, onDelete }: ItemToolsProps): ReactNode {
  return (
    <div className="stu-tools">
      <button
        type="button"
        className="icon-btn stu-tool"
        aria-label={`${name}を上へ`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="icon-btn stu-tool"
        aria-label={`${name}を下へ`}
        disabled={index >= count - 1}
        onClick={() => onMove(1)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {onDelete ? (
        <button type="button" className="icon-btn stu-tool stu-tool-danger" aria-label={`${name}を削除`} onClick={onDelete}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path
              d="M5 7h14M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/** Lint issues of one item, shown at the top of its form. */
export function IssueList({ issues, title = '確認が必要な点' }: { issues: readonly ValidationIssue[]; title?: string }): ReactNode {
  if (issues.length === 0) return null;
  const errors = issues.some((i) => i.severity === 'error');
  return (
    <div className={`stu-issues ${errors ? 'is-error' : 'is-warning'}`} role="note">
      <p className="stu-issues-title">
        <span aria-hidden="true">{errors ? '⚠️' : '💡'}</span> {title}
      </p>
      <ul>
        {issues.map((i, k) => (
          <li key={`${i.path}:${i.code}:${k}`}>
            <span className="visually-hidden">{i.severity === 'error' ? 'エラー：' : '注意：'}</span>
            {i.messageJa}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Radio group rendered as large tappable options. */
export function ChoiceGroup<T extends string>(props: {
  legend: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange(value: T): void;
  visibility?: Visibility;
}): ReactNode {
  const { legend, value, options, onChange, visibility } = props;
  const name = useId();
  return (
    <fieldset className="stu-choice">
      <legend className="stu-choice-legend">
        {legend}
        {visibility ? <VisibilityBadge kind={visibility} /> : null}
      </legend>
      <div className="stu-choice-options">
        {options.map((o) => (
          <label key={o.value} className={`stu-choice-option${o.value === value ? ' is-checked' : ''}`}>
            <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span className="stu-choice-text">
              <span className="stu-choice-label">{o.label}</span>
              {o.hint ? <span className="stu-choice-hint">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
