// Restarts the app from the top (used after 全データを消す): the settings route is replaced with '#/' so the
// reloaded app starts at the age gate without landing back on 設定. Kept separate so tests can mock it.
export function restartApp(): void {
  try {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
  } catch {
    // ignore: the reload still starts from the gate
  }
  window.location.reload();
}
