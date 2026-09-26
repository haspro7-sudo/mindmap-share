/**
 * jsdom realm fix for UI tests that run real crypto (PIN, 合言葉, sealed extras, imports).
 *
 * In vitest's jsdom environment the globals `Uint8Array` and `ArrayBuffer` are jsdom's (another JS realm),
 * while TextEncoder and WebCrypto return Node-realm values, so `x instanceof Uint8Array` checks in src/core
 * fail ("password must be a Uint8Array"). Importing this module points both globals back at Node's
 * intrinsics. It is a no-op in the node environment. renderWithProviders imports it; tests that do not
 * use renderWithProviders can `import '../test/jsdomRealm'` (path relative to the test) themselves.
 */
const nodeUint8Array = Object.getPrototypeOf(new TextEncoder().encode('')).constructor as typeof Uint8Array;
const nodeArrayBuffer = new TextEncoder().encode('').buffer.constructor as typeof ArrayBuffer;

if (nodeUint8Array !== globalThis.Uint8Array) {
  Object.defineProperty(globalThis, 'Uint8Array', { value: nodeUint8Array, writable: true, configurable: true });
}
if (nodeArrayBuffer !== globalThis.ArrayBuffer) {
  Object.defineProperty(globalThis, 'ArrayBuffer', { value: nodeArrayBuffer, writable: true, configurable: true });
}

export {};
