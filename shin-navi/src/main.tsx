// Entry: register every string namespace, load styles, mount the app.
import './i18n/vocab'
import './i18n/reason'
import './i18n/core'
import './i18n/common'
import './styles/base.css'
import './styles/tokens.css'
import './styles/app.css'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(<App />)
