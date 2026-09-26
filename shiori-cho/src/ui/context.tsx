/**
 * CONTRACT: React contexts and hooks shared by every screen.
 * Screens get the repository from context (IdbRepo in the app, MemoryRepo in the studio preview and tests),
 * so they never import storage implementations directly.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import type { Settings } from '../core/types';
import type { ShioriRepo, StudioRepo } from '../storage/repo';

export const RepoContext = createContext<ShioriRepo | null>(null);
export const StudioRepoContext = createContext<StudioRepo | null>(null);

export function useRepo(): ShioriRepo {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error('RepoContext is missing');
  return repo;
}

export function useStudioRepo(): StudioRepo {
  const repo = useContext(StudioRepoContext);
  if (!repo) throw new Error('StudioRepoContext is missing');
  return repo;
}

export interface SettingsApi {
  settings: Settings;
  update(patch: Partial<Settings>): Promise<void>;
}
export const SettingsContext = createContext<SettingsApi | null>(null);

export function useSettings(): SettingsApi {
  const api = useContext(SettingsContext);
  if (!api) throw new Error('SettingsContext is missing');
  return api;
}

export interface ToastOptions {
  action?: { label: string; onClick: () => void };
  /** default 3000 ms (5000 ms when an action is given) */
  durationMs?: number;
  tone?: 'default' | 'ok' | 'danger';
}
export interface ConfirmOptions {
  title: string;
  body?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
export interface PromptOptions extends ConfirmOptions {
  label: string;
  initialValue?: string;
  inputType?: 'text' | 'password';
  /** return a Japanese error message to block OK, or null when valid */
  validate?: (value: string) => string | null;
}

/** App-wide UI services (implemented by shell/UiProvider). */
export interface UiApi {
  toast(message: string, opts?: ToastOptions): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** resolves to the entered string, or null when cancelled */
  prompt(opts: PromptOptions): Promise<string | null>;
  /** queue the envelope animation + reader for newly opened sealed items */
  queueEnvelopes(items: ReadonlyArray<{ workId: string; sealedId: string }>): void;
  /** switch to the camouflage notepad immediately (「隠す」 / Escape) */
  hide(): void;
  /** lock now (only meaningful when a PIN is set) */
  lockNow(): void;
}
export const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const api = useContext(UiContext);
  if (!api) throw new Error('UiContext is missing');
  return api;
}

export interface RepoQuery<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  reload(): void;
}

/**
 * Runs `fn(repo)` on mount, whenever `deps` change and after every committed repository mutation.
 * Out-of-order results are discarded. Keeps the previous data while reloading.
 */
export function useRepoQuery<T>(fn: (repo: ShioriRepo) => Promise<T>, deps: DependencyList): RepoQuery<T> {
  const repo = useRepo();
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: unknown }>({
    data: undefined,
    loading: true,
    error: undefined,
  });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  useEffect(() => repo.subscribe(() => setTick((t) => t + 1)), [repo]);

  useEffect(() => {
    const mySeq = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    fnRef
      .current(repo)
      .then((data) => {
        if (mySeq === seq.current) setState({ data, loading: false, error: undefined });
      })
      .catch((error: unknown) => {
        if (mySeq === seq.current) setState((s) => ({ data: s.data, loading: false, error }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Same as useRepoQuery for the studio repository. */
export function useStudioQuery<T>(fn: (repo: StudioRepo) => Promise<T>, deps: DependencyList): RepoQuery<T> {
  const repo = useStudioRepo();
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: unknown }>({
    data: undefined,
    loading: true,
    error: undefined,
  });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  useEffect(() => repo.subscribe(() => setTick((t) => t + 1)), [repo]);

  useEffect(() => {
    const mySeq = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    fnRef
      .current(repo)
      .then((data) => {
        if (mySeq === seq.current) setState({ data, loading: false, error: undefined });
      })
      .catch((error: unknown) => {
        if (mySeq === seq.current) setState((s) => ({ data: s.data, loading: false, error }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
