// STUB (UI contract)
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}
export declare function EmptyState(props: EmptyStateProps): ReactNode;
