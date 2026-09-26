// F12 AC2: the envelope-opening animation played the first time a sealed extra opens.
// At most 1.5 s (ENVELOPE_MS), a tap / Enter skips it; with prefers-reduced-motion it becomes a 200 ms fade
// (ENVELOPE_REDUCED_MS). Only public data (the sealed item's label and kind) is shown.
// The overlay covers the whole screen, header included, so with `onHide` it has its own 「隠す」 and Escape
// hides (F2 AC3) — Escape never skips to the reader, which would show the sealed text instead of hiding.
// Without `onHide` (standalone), Escape skips like a tap.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion } from '../../app/platform';
import type { SealedKind } from '../../core/types';
import { HideButton } from './HideButton';
import { useFocusTrap, useOverlayLayer } from './overlay';
import { SEALED_KIND_ICON } from './sealedKind';
import { useLatest } from './useLatest';
import './EnvelopeReveal.css';

export const ENVELOPE_MS = 1400;
export const ENVELOPE_REDUCED_MS = 200;

export interface EnvelopeRevealProps {
  kind?: SealedKind;
  /** public label of the sealed item (「あとがき」) */
  label?: string;
  onDone(): void;
  /** 「隠す」 / Escape: switch to the camouflage (the envelope then waits and replays afterwards) */
  onHide?(): void;
  /** defaults to the user's prefers-reduced-motion setting */
  reducedMotion?: boolean;
}

export function EnvelopeReveal({ kind = 'letter', label, onDone, onHide, reducedMotion }: EnvelopeRevealProps): ReactNode {
  const reduced = reducedMotion ?? prefersReducedMotion();
  const duration = reduced ? ENVELOPE_REDUCED_MS : ENVELOPE_MS;
  const doneRef = useRef(false);
  const onDoneRef = useLatest(onDone);
  const onHideRef = useLatest(onHide);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  };

  useEffect(() => {
    doneRef.current = false;
    const t = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDoneRef.current();
    }, duration);
    return () => clearTimeout(t);
  }, [duration, onDoneRef]);

  useOverlayLayer(true, () => {
    const hide = onHideRef.current;
    if (hide) hide();
    else finish();
  });
  useFocusTrap(rootRef, true, buttonRef);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={rootRef}
      className={`env-root ${reduced ? 'env-reduced' : 'env-animated'}`}
      style={{ ['--env-ms' as string]: `${duration}ms` }}
      data-reduced-motion={reduced ? 'true' : 'false'}
      data-testid="envelope-reveal"
      tabIndex={-1}
    >
      <button ref={buttonRef} type="button" className="env-skip" onClick={finish}>
        <span className="env-stage" aria-hidden="true">
          <svg className="env-svg" viewBox="0 0 200 160" width="200" height="160" focusable="false">
            <path d="M20 60 L100 6 L180 60 Z" className="env-flap env-flap-open" />
            <g className="env-letter">
              <rect x="38" y="40" width="124" height="96" rx="6" className="env-paper" />
              <line x1="56" y1="66" x2="144" y2="66" className="env-lines" />
              <line x1="56" y1="82" x2="144" y2="82" className="env-lines" />
              <line x1="56" y1="98" x2="120" y2="98" className="env-lines" />
            </g>
            <path d="M20 60 L100 116 L180 60 L180 150 L20 150 Z" className="env-body" />
            <path d="M20 150 L84 104 M180 150 L116 104" className="env-fold" />
            <path d="M20 60 L100 116 L180 60 Z" className="env-flap env-flap-closed" />
            <circle cx="100" cy="108" r="9" className="env-seal" />
          </svg>
          <span className="env-kind">{SEALED_KIND_ICON[kind]}</span>
        </span>
        {/* the visible text is the button's accessible name (it includes the item's label) */}
        <span className="env-text">
          <span className="env-title">おまけが届きました</span>
          {label ? <span className="env-label">{label}</span> : null}
          <span className="env-hint">タップで読む</span>
        </span>
      </button>
      {onHide ? <HideButton onHide={onHide} className="btn-ghost env-hide" /> : null}
    </div>,
    document.body,
  );
}
