// F8 AC2: 600 ms press-and-hold with a progress ring; keyboard/assistive activation (and a click without a
// completed hold) opens a confirm dialog instead. With `confirm`, the confirm dialog ALWAYS follows the hold
// (used for the 答え tier: 「答えを表示します。よろしいですか？」).
import { useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { HOLD_TO_REVEAL_MS } from '../../core/constants';
import { useUi } from '../context';
import { useLatest } from './useLatest';
import './HoldToReveal.css';

export interface HoldToRevealProps {
  /** button text, e.g. 「ヒント1を見る（長押し）」 */
  label: string;
  onReveal(): void;
  disabled?: boolean;
  /** when set, a confirm dialog is ALWAYS shown after the hold (used for the 答え tier) */
  confirm?: { title: string; body?: string; okLabel?: string };
  holdMs?: number;
}

const DEFAULT_CONFIRM = {
  title: '表示してもよろしいですか？',
  body: 'ネタバレを含むことがあります。',
  okLabel: '表示する',
};

const RING = 22;
const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;

export function HoldToReveal({ label, onReveal, disabled = false, confirm, holdMs = HOLD_TO_REVEAL_MS }: HoldToRevealProps): ReactNode {
  const ui = useUi();
  const hintId = useId();
  const [progress, setProgress] = useState(0);
  const [asking, setAsking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const startedAt = useRef(0);
  /** the click that follows a completed hold must not open the dialog a second time */
  const suppressClick = useRef(false);
  const mounted = useRef(true);
  const propsRef = useLatest({ onReveal, confirm, disabled });

  const stopHold = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    if (frame.current !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
    frame.current = undefined;
    setProgress(0);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== undefined) clearTimeout(timer.current);
      if (frame.current !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
    };
  }, []);

  // Becoming disabled mid-hold cancels the hold (the ring is hidden while disabled, see `shown`).
  useEffect(() => {
    if (!disabled) return;
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    if (frame.current !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
    frame.current = undefined;
  }, [disabled]);

  const askThenReveal = async (opts: { title: string; body?: string; okLabel?: string }) => {
    setAsking(true);
    try {
      const ok = await ui.confirm({ ...opts, okLabel: opts.okLabel ?? DEFAULT_CONFIRM.okLabel });
      if (ok && mounted.current) propsRef.current.onReveal();
    } finally {
      if (mounted.current) setAsking(false);
    }
  };

  const completeHold = () => {
    timer.current = undefined;
    if (propsRef.current.disabled) return;
    if (frame.current !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame.current);
    frame.current = undefined;
    setProgress(0);
    suppressClick.current = true;
    const c = propsRef.current.confirm;
    if (c) void askThenReveal(c);
    else propsRef.current.onReveal();
  };

  /** rAF callback: `ts` shares its time origin with the pointer event's timeStamp */
  const tick = (ts: number) => {
    if (startedAt.current < 0) startedAt.current = ts;
    const p = Math.max(0.001, Math.min(1, (ts - startedAt.current) / holdMs));
    setProgress(p);
    if (p < 1) frame.current = requestAnimationFrame(tick);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || asking) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressClick.current = false;
    startedAt.current = -1;
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(completeHold, holdMs);
    setProgress(0.001);
    if (typeof requestAnimationFrame === 'function') frame.current = requestAnimationFrame(tick);
  };

  const cancelHold = () => {
    if (timer.current !== undefined) stopHold();
  };

  const onClick = () => {
    if (disabled || asking) return;
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // Keyboard / assistive activation, or a tap that was released before the hold completed.
    void askThenReveal(propsRef.current.confirm ?? DEFAULT_CONFIRM);
  };

  const shown = disabled ? 0 : progress;
  const holding = shown > 0;
  return (
    <>
      <button
        type="button"
        className={`htr${holding ? ' is-holding' : ''}`}
        disabled={disabled}
        aria-describedby={hintId}
        onPointerDown={onPointerDown}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        onClick={onClick}
      >
        <svg className="htr-ring" width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true" focusable="false">
          <circle cx={RING / 2} cy={RING / 2} r={RING_R} className="htr-ring-track" strokeWidth="3" fill="none" />
          <circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_R}
            className="htr-ring-fill"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - shown)}
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        </svg>
        <span className="htr-label">{label}</span>
      </button>
      <span id={hintId} className="visually-hidden">
        長押しで表示します。キーボードでは確認のあとに表示します。
      </span>
    </>
  );
}
