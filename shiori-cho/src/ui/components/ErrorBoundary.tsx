// Catches render errors below it (including a lazily loaded screen whose chunk failed to download, e.g.
// offline before the service worker cached it) and shows `fallback` instead of letting React unmount the
// whole app. Give it a `key` (e.g. the route) so that it starts over on navigation.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** what to show instead; `reset` tries rendering the children again */
  fallback: (reset: () => void) => ReactNode;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[shiori] screen failed to render', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}
