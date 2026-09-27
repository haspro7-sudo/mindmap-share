// Root safety net (QA ROBUST#1): whatever breaks while rendering — typically a snapshot saved by
// an older build — the viewer gets a calm panel with one way out instead of a blank page.
// It must not depend on the store (which may be the thing that is broken).
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearAllStorage, freezePersistence } from '../core/storage'
import { shellStrings } from '../i18n/shell'

type Props = { children: ReactNode }
type State = { error: Error | null }

function resetAndReload(): void {
  freezePersistence()
  clearAllStorage()
  try {
    // drop ?reset so a later F5 does not wipe again; keep the rest of the URL (seed, view, script…)
    const u = new URL(location.href)
    u.searchParams.delete('reset')
    location.replace(u.toString())
  } catch {
    location.reload()
  }
}

function Fallback() {
  const t = shellStrings.t
  return (
    <div className="app-error" role="alert" data-testid="app-error">
      <div className="app-error__card">
        <span className="app-error__ball" aria-hidden="true" />
        <div className="app-error__title">{t('errorTitle')}</div>
        <p className="app-error__body">{t('errorBody')}</p>
        <button type="button" className="app-error__reset" data-testid="app-error-reset" onClick={resetAndReload}>
          {t('errorReset')}
        </button>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('[app] render failed', error, info.componentStack)
  }

  render() {
    return this.state.error ? <Fallback /> : this.props.children
  }
}
