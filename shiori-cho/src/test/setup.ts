// Shared test setup. Node 22 provides globalThis.crypto (WebCrypto) and TextEncoder.
// IndexedDB tests import 'fake-indexeddb/auto' themselves.
if (!globalThis.crypto?.subtle) {
  throw new Error('WebCrypto (globalThis.crypto.subtle) is required for tests')
}
