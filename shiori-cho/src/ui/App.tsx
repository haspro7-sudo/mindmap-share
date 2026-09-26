/**
 * Composition root.
 *
 * `App` opens the IndexedDB repositories once (player DB 'shiori' and studio DB 'shiori-studio'), shows a
 * neutral loading state, and a friendly Japanese error when IndexedDB is unavailable (private browsing, …).
 *
 * `AppRoot` (also used by tests with memory repositories) provides RepoContext, StudioRepoContext and
 * SettingsContext, and renders the shell. Overlay precedence (docs/SPEC.md §6):
 *   AgeGate (nothing else renders, no work data is read) → Onboarding → Camouflage (when hidden) →
 *   LockScreen (PIN set and locked) → the app (Header, route outlet, BottomNav).
 * While camouflaged the lock is deferred: returning with the long-press leads to the PIN when one is set,
 * so the notepad never turns into a PIN pad on its own (that would give it away).
 * PrivacyVeil covers everything while the page is hidden (discreet.blurOnHide).
 *
 * Auto-lock: locked on cold start when a PIN exists; when the page becomes visible again after being hidden
 * for at least autoLockSec (0 = immediately, already on hide). Escape (outside dialogs / IME composition)
 * and the header's 「隠す」 switch to the camouflage notepad within the same frame; document.title is
 * 'しおり帳', or 'メモ' while camouflaged.
 */
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DB_PLAYER } from '../core/constants';
import { isShioriError } from '../core/errors';
import type { Route } from '../core/route';
import type { Settings } from '../core/types';
import { deleteIdbDatabase, openIdbRepo } from '../storage/idbRepo';
import type { ShioriRepo, StudioRepo } from '../storage/repo';
import { openIdbStudioRepo } from '../storage/studioRepo';
import { hasOpenOverlay } from './components/overlay';
import { useLatest } from './components/useLatest';
import { RepoContext, StudioRepoContext, useSettings } from './context';
import { navigate, useRoute } from './router';
import { AddWorkScreen } from './screens/AddWork';
import { CodeEntryScreen } from './screens/CodeEntry';
import { HelpScreen } from './screens/Help';
import { HomeScreen } from './screens/Home';
import { NotFoundScreen } from './screens/NotFound';
import { SettingsScreen } from './screens/Settings';
import { UnlockLanding } from './screens/UnlockLanding';
import { WorkEditScreen } from './screens/work/WorkEdit';
import { WorkScreen } from './screens/work/WorkScreen';
import type { WorkScreenProps } from './screens/work/WorkScreen';
import { AgeGate } from './shell/AgeGate';
import { BottomNav } from './shell/BottomNav';
import { BrandMark } from './shell/BrandMark';
import { Camouflage } from './shell/Camouflage';
import { Header } from './shell/Header';
import { LockScreen } from './shell/LockScreen';
import { isFullscreen } from './shell/navigation';
import { Onboarding } from './shell/Onboarding';
import { PrivacyVeil } from './shell/PrivacyVeil';
import { SettingsProvider } from './shell/SettingsProvider';
import { UiProvider } from './shell/UiProvider';
import { UpdatePrompt } from './shell/UpdatePrompt';
import './App.css';

// Rarely used, heavier screens (creator studio with zip/QR, PC simulator) load on demand.
const StudioListScreen = lazy(() => import('./studio/StudioList').then((m) => ({ default: m.StudioListScreen })));
const StudioProjectScreen = lazy(() => import('./studio/StudioProject').then((m) => ({ default: m.StudioProjectScreen })));
const StudioPreviewScreen = lazy(() => import('./studio/Preview').then((m) => ({ default: m.StudioPreviewScreen })));
const DemoPcScreen = lazy(() => import('./screens/DemoPc').then((m) => ({ default: m.DemoPcScreen })));

export const TITLE_APP = 'しおり帳';
export const TITLE_CAMOUFLAGE = 'メモ';

// ───────────────────────── App (IndexedDB) ─────────────────────────

interface Opened {
  repo: ShioriRepo;
  studioRepo: StudioRepo;
  settings: Settings;
}

let opening: Promise<Opened> | null = null;

/** Opens both databases once per page load (StrictMode runs effects twice). */
function openRepositories(): Promise<Opened> {
  if (!opening) {
    opening = (async () => {
      const [repo, studioRepo] = await Promise.all([openIdbRepo(), openIdbStudioRepo()]);
      return { repo, studioRepo, settings: await repo.getSettings() };
    })();
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

/** 全データを消す from the lock screen: deletes DB 'shiori' only (the studio DB is untouched), then reloads. */
async function wipePlayerData(): Promise<void> {
  try {
    await deleteIdbDatabase(DB_PLAYER);
  } catch (e) {
    console.error('[shiori] could not delete the database', e);
  }
  window.location.reload();
}

type BootState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & Opened);

export function App(): ReactNode {
  const [state, setState] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    openRepositories().then(
      (o) => {
        if (alive) setState({ status: 'ready', ...o });
      },
      (e: unknown) => {
        console.error('[shiori] storage unavailable', e);
        if (alive) {
          setState({
            status: 'error',
            message: isShioriError(e)
              ? e.messageJa
              : 'データの保存場所を開けませんでした。プライベートブラウズを解除するか、別のブラウザでお試しください。',
          });
        }
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="app-boot" data-shell="loading" role="status" aria-live="polite">
        <BrandMark size={36} />
        <span className="muted">読み込み中…</span>
      </div>
    );
  }
  if (state.status === 'error') return <StorageError message={state.message} />;
  return <AppRoot repo={state.repo} studioRepo={state.studioRepo} initialSettings={state.settings} onWipe={wipePlayerData} />;
}

function StorageError({ message }: { message: string }): ReactNode {
  return (
    <main className="app-boot app-error" data-shell="error">
      <div className="app-error-card card">
        <div className="app-error-brand">
          <BrandMark size={28} />
          <span>しおり帳</span>
        </div>
        <h1 className="app-error-title">データの保存場所を使えません</h1>
        <p role="alert">{message}</p>
        <ul className="app-error-tips small muted">
          <li>プライベートブラウズ（シークレットモード）では使えないことがあります。</li>
          <li>ブラウザの設定で、このサイトのデータ保存を許可してください。</li>
          <li>端末の空き容量が少ないときは、容量を空けてからお試しください。</li>
        </ul>
        <button type="button" className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </div>
    </main>
  );
}

// ───────────────────────── AppRoot (any repositories) ─────────────────────────

export interface AppRootProps {
  repo: ShioriRepo;
  studioRepo: StudioRepo;
  /** settings loaded before the first render (skips a loading flash); read from the repo otherwise */
  initialSettings?: Settings;
  /** 「PINを忘れた」 → 全データを消して初期化 (after the double confirmation) */
  onWipe(): void;
}

export function AppRoot({ repo, studioRepo, initialSettings, onWipe }: AppRootProps): ReactNode {
  return (
    <RepoContext.Provider value={repo}>
      <StudioRepoContext.Provider value={studioRepo}>
        <SettingsProvider
          repo={repo}
          initial={initialSettings}
          fallback={
            <div className="app-boot" data-shell="loading" role="status">
              <span className="muted">読み込み中…</span>
            </div>
          }
        >
          <Shell onWipe={onWipe} />
        </SettingsProvider>
      </StudioRepoContext.Provider>
    </RepoContext.Provider>
  );
}

function Shell({ onWipe }: { onWipe(): void }): ReactNode {
  const { settings, update } = useSettings();
  const [locked, setLocked] = useState(() => settings.pin !== undefined);
  const [hidden, setHidden] = useState(false);
  const settingsRef = useLatest(settings);
  const hiddenAt = useRef<number | null>(null);

  const ageOk = settings.ageConfirmedAt !== undefined;
  const gatesPassed = ageOk && settings.onboardedAt !== undefined;
  const lockActive = locked && settings.pin !== undefined;

  const hide = useCallback(() => setHidden(true), []);
  const lockNow = useCallback(() => {
    const s = settingsRef.current;
    if (s.pin) setLocked(true);
  }, [settingsRef]);
  const returnFromCamouflage = useCallback(() => {
    const s = settingsRef.current;
    setHidden(false);
    if (s.pin) setLocked(true);
  }, [settingsRef]);

  useLayoutEffect(() => {
    document.title = hidden ? TITLE_CAMOUFLAGE : TITLE_APP;
  }, [hidden]);

  // Auto-lock after the page was hidden for autoLockSec.
  useEffect(() => {
    const onVisibility = () => {
      const s = settingsRef.current;
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        if (s.pin && s.autoLockSec === 0) setLocked(true);
        return;
      }
      const at = hiddenAt.current;
      hiddenAt.current = null;
      if (at !== null && s.pin && Date.now() - at >= s.autoLockSec * 1000) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [settingsRef]);

  // Escape → camouflage (not while a dialog/sheet is open, and never during IME composition).
  useEffect(() => {
    if (!gatesPassed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      if (hasOpenOverlay()) return;
      e.preventDefault();
      setHidden(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gatesPassed]);

  if (!ageOk) {
    return (
      <>
        <AgeGate
          onConfirm={() => {
            update({ ageConfirmedAt: Date.now() }).catch((e: unknown) => console.error('[shiori] could not save', e));
          }}
        />
        <PrivacyVeil />
      </>
    );
  }

  let content: ReactNode;
  // Onboarding keeps the current route, so a deep link (#/u/…) opened on first launch still runs afterwards.
  if (!gatesPassed) content = <Onboarding onDone={() => undefined} />;
  else if (hidden) content = <Camouflage onReturn={returnFromCamouflage} />;
  else if (lockActive) content = <LockScreen onUnlock={() => setLocked(false)} onWipe={onWipe} />;
  else content = <AppFrame onHide={hide} />;

  const appVisible = gatesPassed && !hidden && !lockActive;
  return (
    <UiProvider onHide={hide} onLock={lockNow} suspended={hidden || lockActive}>
      {content}
      <div className="app-update" hidden={!appVisible}>
        <UpdatePrompt />
      </div>
      <PrivacyVeil />
    </UiProvider>
  );
}

// ───────────────────────── the app frame and route outlet ─────────────────────────

function pageKey(route: Route): string {
  switch (route.name) {
    case 'work':
    case 'workEdit':
    case 'studioProject':
    case 'studioPreview':
      return `${route.name}:${route.id}`;
    case 'unlock':
      return `unlock:${route.manifestWorkId}:${route.code}`;
    case 'help':
      return `help:${route.section ?? ''}`;
    case 'code':
      return `code:${route.workId ?? ''}`;
    default:
      return route.name;
  }
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

function AppFrame({ onHide }: { onHide(): void }): ReactNode {
  const route = useRoute();
  const full = isFullscreen(route);
  const key = pageKey(route);
  /** true when the open work sheet was pushed onto history by us (closing then goes back) */
  const sheetPushed = useRef(false);

  useEffect(() => {
    if (!isJsdom()) window.scrollTo({ top: 0, left: 0 });
  }, [key]);

  const routeSheet = route.name === 'work' ? route.sheet : undefined;
  useEffect(() => {
    if (!routeSheet) sheetPushed.current = false;
  }, [routeSheet]);

  const onWorkChange = useCallback(
    (id: string, current: WorkScreenProps['sheet']): WorkScreenProps['onChange'] =>
      (next) => {
        const target: Route = next.sheet
          ? { name: 'work', id, tab: next.tab, sheet: next.sheet }
          : { name: 'work', id, tab: next.tab };
        if (!next.sheet && current && sheetPushed.current) {
          sheetPushed.current = false;
          window.history.back();
          return;
        }
        if (next.sheet && !current) {
          sheetPushed.current = true;
          navigate(target);
          return;
        }
        navigate(target, { replace: true });
      },
    [],
  );

  let screen: ReactNode;
  switch (route.name) {
    case 'home':
      screen = <HomeScreen />;
      break;
    case 'add':
      screen = <AddWorkScreen />;
      break;
    case 'work':
      screen = <WorkScreen workId={route.id} tab={route.tab} sheet={route.sheet} onChange={onWorkChange(route.id, route.sheet)} />;
      break;
    case 'workEdit':
      screen = <WorkEditScreen workId={route.id} />;
      break;
    case 'code':
      screen = <CodeEntryScreen workId={route.workId} />;
      break;
    case 'unlock':
      screen = <UnlockLanding manifestWorkId={route.manifestWorkId} code={route.code} />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    case 'studio':
      screen = <StudioListScreen />;
      break;
    case 'studioProject':
      screen = <StudioProjectScreen projectId={route.id} tab={route.tab} />;
      break;
    case 'studioPreview':
      screen = <StudioPreviewScreen projectId={route.id} />;
      break;
    case 'demoPc':
      screen = <DemoPcScreen />;
      break;
    case 'help':
      screen = <HelpScreen section={route.section} />;
      break;
    case 'notFound':
      screen = <NotFoundScreen />;
      break;
  }

  return (
    <div className={`app${full ? ' is-fullscreen' : ' has-nav'}`} data-shell="app" data-route={route.name}>
      <Header onHide={onHide} />
      <div className="app-main" key={key}>
        <Suspense fallback={<div className="app-lazy" role="status" aria-live="polite">読み込み中…</div>}>{screen}</Suspense>
      </div>
      {full ? null : <BottomNav />}
    </div>
  );
}
