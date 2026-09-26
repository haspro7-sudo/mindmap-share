// Accessible tab bar (role="tablist"), horizontally scrollable on narrow screens.
// Arrow keys / Home / End move between tabs (automatic activation); only the selected tab is in the Tab order.
// Tab buttons get the id `tab-<id>`, so a panel can use aria-labelledby="tab-<id>".
import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import './Tabs.css';

export interface TabsProps<T extends string> {
  tabs: ReadonlyArray<{ id: T; label: string; badge?: string | number }>;
  value: T;
  /** NoInfer: T is inferred from `tabs` / `value`, so `onChange={setTab}` type-checks */
  onChange(id: NoInfer<T>): void;
  ariaLabel: string;
}

export function Tabs<T extends string>({ tabs, value, onChange, ariaLabel }: TabsProps<T>): ReactNode {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    const el = refs.current.get(target.id);
    el?.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            className={`tabs-tab${selected ? ' is-selected' : ''}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(t.id);
            }}
          >
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge !== '' ? <span className="tabs-badge">{t.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
