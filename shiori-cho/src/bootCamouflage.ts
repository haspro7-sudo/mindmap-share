// Imported first by main.tsx: when this tab was left hidden (camouflage flag, see ui/App.tsx), switch the tab
// title to 「メモ」 before anything else loads, so a reload never flashes the app's name.
try {
  if (window.sessionStorage.getItem('shiori.cam') === '1') document.title = 'メモ';
} catch {
  // storage blocked: nothing to restore
}
