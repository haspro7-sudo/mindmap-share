/**
 * Provides SettingsContext bound to a repository: settings are read from `repo.getSettings()`, kept fresh
 * through `repo.subscribe`, and `update(patch)` writes through `repo.updateSettings` (the stored result is
 * applied right away, so `await update(…)` is followed by a render with the new values).
 *
 * With `initial` the children render immediately (the app passes the settings it loaded at startup;
 * tests pass the seeded values). Without it `fallback` renders until the first load finishes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Settings } from '../../core/types';
import type { ShioriRepo } from '../../storage/repo';
import { SettingsContext } from '../context';
import type { SettingsApi } from '../context';

export interface SettingsProviderProps {
  repo: ShioriRepo;
  initial?: Settings;
  fallback?: ReactNode;
  children: ReactNode;
}

export function SettingsProvider({ repo, initial, fallback = null, children }: SettingsProviderProps): ReactNode {
  const [settings, setSettings] = useState<Settings | undefined>(initial);
  /** last started read/write wins, so a slow read never overwrites a newer value */
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      const mine = ++seq.current;
      repo.getSettings().then(
        (s) => {
          if (alive && mine === seq.current) setSettings(s);
        },
        (e: unknown) => {
          console.error('[shiori] settings could not be loaded', e);
        },
      );
    };
    const unsubscribe = repo.subscribe(load);
    load();
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [repo]);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await repo.updateSettings(patch);
      // The stored result is the newest value: discard reads that started before it resolved.
      seq.current += 1;
      setSettings(next);
    },
    [repo],
  );

  const api = useMemo<SettingsApi | null>(() => (settings ? { settings, update } : null), [settings, update]);

  if (!api) return fallback;
  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}
