// PLACEHOLDER (UI contract) — replace with the real screen; keep the export name/props. — #/w/<id> (F7–F9, F12–F14). Navigation is delegated via onChange so the studio preview can host it.
import type { ReactNode } from 'react';
import type { WorkTab } from '../../../core/route';

export type WorkSheet = { type: 'goal' | 'sealed'; index: number } | undefined;
export interface WorkScreenProps {
  workId: string;
  tab: WorkTab;
  sheet?: WorkSheet;
  onChange(next: { tab: WorkTab; sheet?: WorkSheet }): void;
  /** true inside the studio preview (hide edit/delete/store links/session bar persistence notes) */
  preview?: boolean;
}
export function WorkScreen(_props: WorkScreenProps): ReactNode {
  return <main className="screen"><p className="muted">準備中</p></main>;
}
