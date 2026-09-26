// Progress visuals (role="progressbar" with aria-valuenow). pct is clamped to 0..100 and floored; NaN → 0.
import type { ReactNode } from 'react';
import './Progress.css';

export interface ProgressBarProps {
  /** 0..100 */
  pct: number;
  label?: string;
  compact?: boolean;
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, Math.floor(pct)));
}

export function ProgressBar({ pct, label, compact = false }: ProgressBarProps): ReactNode {
  const v = clampPct(pct);
  return (
    <div className={`pg-bar${compact ? ' is-compact' : ''}`}>
      {!compact && label ? (
        <div className="pg-bar-head" aria-hidden="true">
          <span className="pg-bar-label">{label}</span>
          <span className="pg-bar-pct">{v}%</span>
        </div>
      ) : null}
      <div className="pg-bar-row">
        <div
          className="pg-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={v}
          aria-valuetext={`${v}%`}
          aria-label={label ?? '進捗'}
        >
          <div className="pg-fill" style={{ width: `${v}%` }} />
        </div>
        {compact || !label ? (
          <span className="pg-bar-pct" aria-hidden="true">
            {v}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

export interface ProgressRingProps {
  /** 0..100 */
  pct: number;
  /** px, default 88 */
  size?: number;
  /** text under the % inside the ring, e.g. 「5 / 8」 */
  caption?: string;
}

export function ProgressRing({ pct, size = 88, caption }: ProgressRingProps): ReactNode {
  const v = clampPct(pct);
  const stroke = Math.max(6, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="pg-ring"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-valuetext={caption ? `${v}%（${caption}）` : `${v}%`}
      aria-label="全体の進捗"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="pg-ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="pg-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="pg-ring-text" aria-hidden="true">
        <span className="pg-ring-pct" style={{ fontSize: Math.max(12, Math.round(size / 4.4)) }}>
          {v}
          <span className="pg-ring-unit">%</span>
        </span>
        {caption ? <span className="pg-ring-caption">{caption}</span> : null}
      </div>
    </div>
  );
}
