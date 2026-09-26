// Test stand-in for 'virtual:pwa-register/react' (the virtual module only exists in Vite builds with VitePWA).
import { useState } from 'react'

export function useRegisterSW() {
  const needRefresh = useState(false)
  const offlineReady = useState(false)
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: async () => {},
  }
}
