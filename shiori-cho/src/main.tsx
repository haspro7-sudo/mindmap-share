import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/theme.css'
import { App, AppCrash } from './ui/App'
import { ErrorBoundary } from './ui/components/ErrorBoundary'

// Each screen has its own error boundary (App.tsx); this one is the last resort, so a render error outside a
// screen shows a neutral page with 再読み込み instead of an empty document.
createRoot(document.getElementById('root')!, {
  onUncaughtError: (error, info) => console.error('[shiori] uncaught render error', error, info.componentStack),
}).render(
  <StrictMode>
    <ErrorBoundary fallback={() => <AppCrash />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
