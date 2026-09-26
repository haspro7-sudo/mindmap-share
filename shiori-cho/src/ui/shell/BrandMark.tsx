// The plain bookmark mark used by the header and the full-screen gates (no brand, no work data).
import type { ReactNode } from 'react';

export function BrandMark({ size = 28 }: { size?: number }): ReactNode {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="4" y="3" width="24" height="26" rx="4" fill="var(--accent-soft)" />
      <path d="M11 3h10v17l-5-4-5 4z" fill="var(--accent)" />
    </svg>
  );
}
