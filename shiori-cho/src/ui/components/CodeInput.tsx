// F10: large code input with live format feedback via detectCodeKind / parseCode (never a KDF here).
// The error message (codeErrorMessageJa) appears only once the input looks complete, the error is certain
// (a character that can never be valid, mixed scripts), or after Enter. 「貼り付け」 reads the clipboard and
// also extracts the code from a pasted deep-link URL (#/u/<work>/<code>), as does a normal paste.
import { useId, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, ReactNode } from 'react';
import { readClipboard } from '../../app/platform';
import { B32_CODE_LENGTH, KANA_WORD_COUNT, codeErrorMessageJa, detectCodeKind, parseCode } from '../../core/codes';
import { extractUnlockFromText } from '../../core/route';
import type { CodeError } from '../../core/types';
import { useUi } from '../context';
import './CodeInput.css';

export interface CodeInputProps {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  busy?: boolean;
  autoFocus?: boolean;
  /** id for <label htmlFor> */
  id?: string;
}

const MAX_INPUT = 120;
const KANA_CHARS = KANA_WORD_COUNT * 3;
const KANA_LETTERS_RE = /[ぁ-ゖァ-ヺｦ-ﾝ]/gu;
const KANA_SEPARATORS_RE = /[\s、。・,./\-‐‑‒–—―ー－]+/u;
const B32_CHAR_RE = /[0-9A-Za-z]/g;

/** Text pasted from a message or a URL: the code of a deep link, else the trimmed text. */
function codeFromPastedText(text: string): string {
  const link = extractUnlockFromText(text);
  return (link ? link.code : text.trim()).slice(0, MAX_INPUT);
}

interface Feedback {
  tone: 'hint' | 'ok' | 'error';
  text: string;
  display?: string;
}

function isCertainError(e: CodeError): boolean {
  return e.kind === 'charset' || e.kind === 'mixed';
}

function feedbackFor(value: string, attempted: boolean): Feedback {
  const kind = detectCodeKind(value);
  if (kind === null) {
    return attempted
      ? { tone: 'error', text: codeErrorMessageJa({ kind: 'empty' }) }
      : { tone: 'hint', text: `英数字${B32_CODE_LENGTH}文字（例: K7Q-M2X-RAP）か、ひらがな${KANA_WORD_COUNT}語を入れてください` };
  }
  const parsed = parseCode(value);
  if (parsed.ok) {
    return parsed.kind === 'kana'
      ? { tone: 'ok', text: `ひらがなの合言葉（${KANA_WORD_COUNT}語）`, display: parsed.display }
      : { tone: 'ok', text: `英数字の合言葉（${B32_CODE_LENGTH}文字）`, display: parsed.display };
  }
  const normalized = value.normalize('NFKC');
  let complete: boolean;
  let progress: string;
  if (kind === 'kana') {
    const letters = normalized.match(KANA_LETTERS_RE)?.length ?? 0;
    const words = normalized.split(KANA_SEPARATORS_RE).filter((w) => w !== '').length;
    complete = letters >= KANA_CHARS || words >= KANA_WORD_COUNT;
    progress = `ひらがなの合言葉（${KANA_WORD_COUNT}語・いま ${letters}/${KANA_CHARS}文字）`;
  } else {
    const chars = normalized.match(B32_CHAR_RE)?.length ?? 0;
    complete = chars >= B32_CODE_LENGTH;
    progress = `英数字の合言葉（いま ${Math.min(chars, 99)}/${B32_CODE_LENGTH}文字）`;
  }
  if (attempted || complete || isCertainError(parsed.error)) {
    return { tone: 'error', text: codeErrorMessageJa(parsed.error) };
  }
  return { tone: 'hint', text: progress };
}

export function CodeInput({ value, onChange, onSubmit, busy = false, autoFocus = false, id }: CodeInputProps): ReactNode {
  const ui = useUi();
  const autoId = useId();
  const inputId = id ?? autoId;
  const feedbackId = `${inputId}-feedback`;
  const [attempted, setAttempted] = useState(false);
  const feedback = feedbackFor(value, attempted);

  const change = (v: string) => {
    setAttempted(false);
    onChange(v.slice(0, MAX_INPUT));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    if (busy) return;
    setAttempted(true);
    onSubmit();
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text || !extractUnlockFromText(text)) return;
    e.preventDefault();
    change(codeFromPastedText(text));
  };

  const pasteFromClipboard = async () => {
    const text = await readClipboard();
    if (text === null || text.trim() === '') {
      ui.toast('クリップボードを読み取れませんでした。入力欄を長押しして貼り付けてください', { tone: 'danger' });
      return;
    }
    change(codeFromPastedText(text));
  };

  return (
    <div className="ci">
      <div className="ci-row">
        <input
          id={inputId}
          className={`input ci-input${feedback.tone === 'error' ? ' is-error' : feedback.tone === 'ok' ? ' is-ok' : ''}`}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={MAX_INPUT}
          placeholder="K7Q-M2X-RAP"
          value={value}
          autoFocus={autoFocus}
          readOnly={busy}
          aria-busy={busy || undefined}
          aria-invalid={feedback.tone === 'error' ? 'true' : undefined}
          aria-describedby={feedbackId}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button type="button" className="btn ci-paste" onClick={() => void pasteFromClipboard()} disabled={busy}>
          貼り付け
        </button>
      </div>
      <p id={feedbackId} className={`ci-feedback is-${feedback.tone}`} aria-live="polite">
        {feedback.tone === 'ok' ? (
          <span className="ci-mark" aria-hidden="true">
            ✓{' '}
          </span>
        ) : null}
        <span>{feedback.text}</span>
        {feedback.display ? <span className="ci-display mono">{feedback.display}</span> : null}
      </p>
    </div>
  );
}
