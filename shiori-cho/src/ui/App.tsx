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
 * for at least autoLockSec (0 = immediately, already on hide). Escape (outside IME composition) and every
 * 「隠す」 (the header's, and the one on each sheet / dialog / envelope that covers it) switch to the
 * camouflage notepad within the same frame — Escape is taken in the capture phase, before any open layer
 * could use it to close itself or skip to a sealed text. document.title is 'しおり帳', or 'メモ' while
 * camouflaged. The camouflage survives a reload of the tab (sessionStorage flag), so a pull-to-refresh or a
 * discarded background tab comes back as the notepad.
 *
 * Deep links (#/u/…): taken out of the address bar at once, before any gate (shell/deepLinkStash.ts), and
 * processed by UnlockLanding once the app frame is visible.
 *
 * 全データを消して初期化 from the lock screen deletes the player AND studio databases (the PIN guarded both;
 * shell/lockWipe.ts → app/wipe.ts) and restarts at '#/'. A wipe in another window restarts this one too.
 *
 * Each screen renders inside an error boundary (a failed lazy chunk while offline, a render error), so the
 * header with 「隠す」 and the navigation stay usable.
 */
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clearAppSessionStorage, subscribeWiped } from '../app/wipe';
import { isShioriError } from '../core/errors';
import type { Route } from '../core/route';
import type { Settings } from '../core/types';
import { openIdbRepo } from '../storage/idbRepo';
import type { ShioriRepo, StudioRepo } from '../storage/repo';
import { openIdbStudioRepo } from '../storage/studioRepo';
import { EmptyState } from './components/EmptyState';
import { ErrorBoundary } from './components/ErrorBoundary';
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
import { restartApp } from './screens/settings/restart';
import { UnlockLanding } from './screens/UnlockLanding';
import { WorkEditScreen } from './screens/work/WorkEdit';
import { WorkScreen } from './screens/work/WorkScreen';
import type { WorkScreenProps } from './screens/work/WorkScreen';
import { AgeGate } from './shell/AgeGate';
import { BottomNav } from './shell/BottomNav';
import { BrandMark } from './shell/BrandMark';
import { Camouflage } from './shell/Camouflage';
import { clearDeepLinkStash, readDeepLinkStash, writeDeepLinkStash } from './shell/deepLinkStash';
import type { StashedDeepLink } from './shell/deepLinkStash';
import { Header } from './shell/Header';
import { LockScreen } from './shell/LockScreen';
import { wipeFromLockScreen } from './shell/lockWipe';
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
  return <AppRoot repo={state.repo} studioRepo={state.studioRepo} initialSettings={state.settings} onWipe={wipeFromLockScreen} />;
}

/** Last-resort screen when rendering failed outside a route (see main.tsx). Shows no data. */
export function AppCrash(): ReactNode {
  return (
    <main className="app-boot app-error" data-shell="crash">
      <div className="app-error-card card">
        <h1 className="app-error-title">表示できませんでした</h1>
        <p role="alert">問題が起きたため、画面を表示できませんでした。再読み込みしてください。</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </div>
    </main>
  );
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
  /** 「PINを忘れた」 → 全データを消して初期化 (after the double confirmation); a rejection is shown */
  onWipe(): Promise<void> | void;
}

export function AppRoot({ repo, studioRepo, initialSettings, onWipe }: AppRootProps): ReactNode {
  // Another window of the app deleted all data: don't keep showing (or writing back) what is in memory.
  useEffect(
    () =>
      subscribeWiped(() => {
        clearAppSessionStorage();
        restartApp();
      }),
    [],
  );

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

// ───────────────────────── camouflage flag (per tab) ─────────────────────────

const CAMOUFLAGE_KEY = 'shiori.cam';

function readCamouflageFlag(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(CAMOUFLAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCamouflageFlag(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(CAMOUFLAGE_KEY, '1');
    else window.sessionStorage.removeItem(CAMOUFLAGE_KEY);
  } catch {
    // storage unavailable: the camouflage then lasts until the page is reloaded
  }
}

function deepLinkOf(route: Route): StashedDeepLink | null {
  return route.name === 'unlock' ? { manifestWorkId: route.manifestWorkId, code: route.code } : null;
}

function Shell({ onWipe }: { onWipe(): Promise<void> | void }): ReactNode {
  const { settings, update } = useSettings();
  const route = useRoute();
  const [locked, setLocked] = useState(() => settings.pin !== undefined);
  const [hidden, setHidden] = useState(readCamouflageFlag);
  const [deepLink, setDeepLink] = useState<StashedDeepLink | null>(() => deepLinkOf(route) ?? readDeepLinkStash());
  const settingsRef = useLatest(settings);
  const hiddenAt = useRef<number | null>(null);

  const ageOk = settings.ageConfirmedAt !== undefined;
  const gatesPassed = ageOk && settings.onboardedAt !== undefined;
  const lockActive = locked && settings.pin !== undefined;
  const gatesPassedRef = useLatest(gatesPassed);

  const hide = useCallback(() => {
    // Before the first-launch gates are passed there is nothing to hide (and no way back from the notepad).
    if (!gatesPassedRef.current) return;
    writeCamouflageFlag(true);
    setHidden(true);
  }, [gatesPassedRef]);
  const lockNow = useCallback(() => {
    const s = settingsRef.current;
    if (s.pin) setLocked(true);
  }, [settingsRef]);
  const returnFromCamouflage = useCallback(() => {
    const s = settingsRef.current;
    writeCamouflageFlag(false);
    setHidden(false);
    if (s.pin) setLocked(true);
  }, [settingsRef]);

  useLayoutEffect(() => {
    document.title = hidden ? TITLE_CAMOUFLAGE : TITLE_APP;
  }, [hidden]);

  // A deep link leaves the address bar before anything is painted, whatever screen is shown (F11 AC1).
  const link = deepLinkOf(route);
  useLayoutEffect(() => {
    if (!link) return;
    writeDeepLinkStash(link);
    setDeepLink(link);
    navigate({ name: 'code' }, { replace: true });
    // link is derived from the route; its fields are the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.manifestWorkId, link?.code]);
  const deepLinkSettled = useCallback(() => {
    clearDeepLinkStash();
    setDeepLink(null);
  }, []);

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

  // Escape → camouflage, in one step from every screen (F2 AC3): taken in the capture phase, so an open
  // sheet / dialog / envelope never consumes it first (to close itself or to skip to the sealed text).
  // Never during IME composition (Escape then cancels the conversion).
  const hiddenRef = useLatest(hidden);
  useEffect(() => {
    if (!gatesPassed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      if (hiddenRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      hide();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [gatesPassed, hide, hiddenRef]);

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
  // A deep link (#/u/…) opened on first launch is stashed and still runs after onboarding.
  if (!gatesPassed) content = <Onboarding onDone={() => undefined} />;
  else if (hidden) content = <Camouflage onReturn={returnFromCamouflage} />;
  else if (lockActive) content = <LockScreen onUnlock={() => setLocked(false)} onWipe={onWipe} />;
  else content = <AppFrame onHide={hide} deepLink={deepLink ?? link} onDeepLinkSettled={deepLinkSettled} />;

  const appVisible = gatesPassed && !hidden && !lockActive;
  // (before the first-launch gates are passed, onboarding is shown whatever the other flags say)
  return (
    <UiProvider onHide={hide} onLock={lockNow} suspended={gatesPassed && !appVisible} camouflaged={gatesPassed && hidden}>
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

/** Moves focus to the new screen's heading after in-app navigation (unless the screen focused something). */
function focusScreen(main: HTMLElement): void {
  const active = document.activeElement;
  if (active && active !== document.body && main.contains(active)) return;
  if (hasOpenOverlay()) return;
  const heading = main.querySelector<HTMLElement>('h1, h2');
  const target = heading ?? main;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

function ScreenError({ onHome }: { onHome(): void }): ReactNode {
  return (
    <main className="screen app-screen-error">
      <EmptyState
        icon="📄"
        title="画面を表示できませんでした"
        body={'通信できないときに、まだこの端末に保存されていない画面を開くと、表示できないことがあります。\n通信状態を確かめてから、再読み込みしてください。'}
        action={
          <div className="row-wrap app-screen-error-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              再読み込み
            </button>
            <button type="button" className="btn" onClick={onHome}>
              本棚へ
            </button>
          </div>
        }
      />
    </main>
  );
}

interface AppFrameProps {
  onHide(): void;
  /** a deep link to process (shown instead of the route's screen until `onDeepLinkSettled`) */
  deepLink: StashedDeepLink | null;
  onDeepLinkSettled(): void;
}

function AppFrame({ onHide, deepLink, onDeepLinkSettled }: AppFrameProps): ReactNode {
  const route = useRoute();
  const full = isFullscreen(route);
  const key = deepLink ? `deeplink:${deepLink.manifestWorkId}:${deepLink.code}` : pageKey(route);
  /** true when the open work sheet was pushed onto history by us (closing then goes back) */
  const sheetPushed = useRef(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const firstPage = useRef(true);

  useEffect(() => {
    if (!isJsdom()) window.scrollTo({ top: 0, left: 0 });
    // Focus follows in-app navigation (not on the first screen: the app just opened).
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    if (mainRef.current) focusScreen(mainRef.current);
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

  const routeScreen = (): ReactNode => {
    switch (route.name) {
      case 'home':
        return <HomeScreen />;
      case 'add':
        return <AddWorkScreen />;
      case 'work':
        return <WorkScreen workId={route.id} tab={route.tab} sheet={route.sheet} onChange={onWorkChange(route.id, route.sheet)} />;
      case 'workEdit':
        return <WorkEditScreen workId={route.id} />;
      case 'code':
        return <CodeEntryScreen workId={route.workId} />;
      case 'unlock':
        // (the shell turns this route into `deepLink` before it is painted)
        return <UnlockLanding manifestWorkId={route.manifestWorkId} code={route.code} onSettled={onDeepLinkSettled} />;
      case 'settings':
        return <SettingsScreen />;
      case 'studio':
        return <StudioListScreen />;
      case 'studioProject':
        return <StudioProjectScreen projectId={route.id} tab={route.tab} />;
      case 'studioPreview':
        return <StudioPreviewScreen projectId={route.id} />;
      case 'demoPc':
        return <DemoPcScreen />;
      case 'help':
        return <HelpScreen section={route.section} />;
      case 'notFound':
        return <NotFoundScreen />;
    }
  };
  const screen: ReactNode = deepLink ? (
    <UnlockLanding manifestWorkId={deepLink.manifestWorkId} code={deepLink.code} onSettled={onDeepLinkSettled} />
  ) : (
    routeScreen()
  );

  return (
    <div className={`app${full ? ' is-fullscreen' : ' has-nav'}`} data-shell="app" data-route={route.name}>
      <Header onHide={onHide} />
      <div className="app-main" key={key} ref={mainRef}>
        <ErrorBoundary
          fallback={(reset) => (
            <ScreenError
              onHome={() => {
                navigate({ name: 'home' });
                reset();
              }}
            />
          )}
        >
          <Suspense fallback={<div className="app-lazy" role="status" aria-live="polite">読み込み中…</div>}>{screen}</Suspense>
        </ErrorBoundary>
      </div>
      {full ? null : <BottomNav />}
    </div>
  );
}
