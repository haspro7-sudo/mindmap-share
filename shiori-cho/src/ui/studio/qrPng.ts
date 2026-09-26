// PLACEHOLDER (UI contract) — replace with the real implementation; keep the exports. — renders a 512×600 PNG: QR (EC level M) of `url` + `caption` text underneath (canvas; qrcode-generator).
export async function renderQrPng(_url: string, _caption: string): Promise<Uint8Array> {
  throw new Error('renderQrPng: not implemented yet');
}
/** QR as an SVG path string for on-screen display (no network, no innerHTML). */
export function qrSvgPath(_text: string): { size: number; path: string } {
  return { size: 0, path: '' };
}
