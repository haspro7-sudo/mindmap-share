// Neutral empty / not-found state: icon (emoji), title, optional body and action.
import type { ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  body?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps): ReactNode {
  return (
    <div className="es">
      {icon ? (
        <div className="es-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h2 className="es-title">{title}</h2>
      {body ? <p className="es-body pre">{body}</p> : null}
      {action ? <div className="es-action">{action}</div> : null}
    </div>
  );
}
