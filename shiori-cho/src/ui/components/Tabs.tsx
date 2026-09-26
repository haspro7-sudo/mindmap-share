// STUB (UI contract) — accessible tab bar (role="tablist"), horizontally scrollable on narrow screens.
import type { ReactNode } from 'react';

export interface TabsProps<T extends string> {
  tabs: ReadonlyArray<{ id: T; label: string; badge?: string | number }>;
  value: T;
  onChange(id: T): void;
  ariaLabel: string;
}
export declare function Tabs<T extends string>(props: TabsProps<T>): ReactNode;
