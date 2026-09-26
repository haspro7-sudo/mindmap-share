// #/u/<manifestWorkId>/<code> deep-link landing (docs/SPEC.md F11).
// Inside the app the shell has already moved the link out of the address bar (shell/deepLinkStash.ts) and
// renders this screen from the stash once the app is visible; `onSettled` then clears the stash.
// Runs handleDeepLink once per link (a ref guards against StrictMode's double effect, and a per-repository
// in-flight map makes a remount — after 「隠す」 or an auto-lock during the key derivation — wait for the SAME
// run instead of starting a second one that would report 「入力済み」), then replaces the history entry so
// the code never stays in the address bar:
//   unlocked / already → #/w/<localId> (envelopes queued, toast)
//   pending / noMatch / invalid (or an error) → #/code with a toast; the code screen picks up a one-shot
//   hand-off (codeHandoff.ts) to show the result, and on iOS Safari outside the home-screen app the
//   「コピー → 貼り付け」 notice with a copy button (F11 AC3).
// A result that arrives while this screen is not mounted is kept until the next mount shows it.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { isIosSafariNotStandalone, vibrate, writeClipboard } from '../../app/platform';
import { handleDeepLink } from '../../app/unlock';
import { codeErrorMessageJa, displayFromCanonical } from '../../core/codes';
import type { UnlockOutcome } from '../../core/types';
import type { ShioriRepo } from '../../storage/repo';
import { useLatest } from '../components/useLatest';
import { useRepo, useUi } from '../context';
import { navigate } from '../router';
import { writeCodeHandoff } from './codeHandoff';
import { errorMessageJa } from './libraryShared';
import './UnlockLanding.css';

export const IOS_COPY_NOTICE = 'ホーム画面のしおり帳で使う場合：合言葉をコピー → しおり帳の『合言葉』で貼り付け';

/** Deep-link runs whose result has not been shown yet, per repository and link. */
const inflight = new WeakMap<ShioriRepo, Map<string, Promise<UnlockOutcome>>>();

function runDeepLink(repo: ShioriRepo, manifestWorkId: string, code: string): { promise: Promise<UnlockOutcome>; done(): void } {
  let runs = inflight.get(repo);
  if (!runs) {
    runs = new Map();
    inflight.set(repo, runs);
  }
  const key = `${manifestWorkId}\u0000${code}`;
  let promise = runs.get(key);
  if (!promise) {
    promise = handleDeepLink(repo, manifestWorkId, code);
    runs.set(key, promise);
  }
  const mine = promise;
  return {
    promise: mine,
    done: () => {
      if (runs.get(key) === mine) runs.delete(key);
    },
  };
}

export interface UnlockLandingProps {
  manifestWorkId: string;
  code: string;
  /** called once the result was shown and the route replaced (the shell clears its stash) */
  onSettled?(): void;
}

export function UnlockLanding({ manifestWorkId, code, onSettled }: UnlockLandingProps): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const started = useRef(false);
  const mounted = useRef(false);
  const uiRef = useLatest(ui);
  const onSettledRef = useLatest(onSettled);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const ios = isIosSafariNotStandalone();

    const settle = () => onSettledRef.current?.();
    const toCode = (status: 'pending' | 'noMatch' | 'invalid', handoffCode: string) => {
      writeCodeHandoff({ status, code: handoffCode, ios: ios && status !== 'invalid' });
      navigate({ name: 'code' }, { replace: true });
      settle();
    };

    const finish = (outcome: UnlockOutcome) => {
      const t = uiRef.current;
      const display = outcome.canonical ? displayFromCanonical(outcome.canonical) : code;
      switch (outcome.status) {
        case 'unlocked':
        case 'already': {
          const workId = outcome.workId;
          if (!workId) {
            toCode('noMatch', display);
            return;
          }
          if (outcome.status === 'unlocked') {
            vibrate(30);
            t.toast(outcome.secret ? `合言葉が通りました：${outcome.secret.title}` : '合言葉が通りました', { tone: 'ok' });
          } else {
            t.toast('この合言葉は入力済みです');
          }
          if (outcome.openedSealedIds.length > 0) {
            t.queueEnvelopes(outcome.openedSealedIds.map((sealedId) => ({ workId, sealedId })));
          }
          if (ios) {
            t.toast(IOS_COPY_NOTICE, {
              durationMs: 15_000,
              action: {
                label: 'コピー',
                onClick: () => {
                  void writeClipboard(display).then((ok) =>
                    uiRef.current.toast(ok ? '合言葉をコピーしました' : 'コピーできませんでした', { tone: ok ? 'ok' : 'danger' }),
                  );
                },
              },
            });
          }
          navigate({ name: 'work', id: workId, tab: 'progress' }, { replace: true });
          settle();
          return;
        }
        case 'pending':
          t.toast('しおりファイルがまだないため、合言葉を保留にしました');
          toCode('pending', display);
          return;
        case 'noMatch':
          t.toast('一致するしおりがありません', { tone: 'danger' });
          toCode('noMatch', display);
          return;
        default:
          t.toast(outcome.error ? codeErrorMessageJa(outcome.error) : '合言葉を確かめてください', { tone: 'danger' });
          toCode('invalid', code);
      }
    };

    const run = runDeepLink(repo, manifestWorkId, code);
    run.promise.then(
      (outcome) => {
        // Unmounted meanwhile (hidden / locked): the run stays in `inflight` for the next mount.
        if (!mounted.current) return;
        run.done();
        finish(outcome);
      },
      (e: unknown) => {
        if (!mounted.current) return;
        run.done();
        uiRef.current.toast(errorMessageJa(e), { tone: 'danger' });
        toCode('invalid', code);
      },
    );
  }, [repo, manifestWorkId, code, uiRef, onSettledRef]);

  return (
    <main className="screen ulp" aria-busy="true">
      <div className="ulp-box" role="status">
        <span className="ulp-spin" aria-hidden="true" />
        <p className="ulp-text">合言葉を確かめています…</p>
      </div>
    </main>
  );
}
