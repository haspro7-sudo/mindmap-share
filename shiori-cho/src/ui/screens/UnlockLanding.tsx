// #/u/<manifestWorkId>/<code> deep-link landing (docs/SPEC.md F11).
// Runs handleDeepLink exactly once (a ref guards against StrictMode's double effect), then replaces the
// history entry so the code never stays in the address bar:
//   unlocked / already → #/w/<localId> (envelopes queued, toast)
//   pending / noMatch / invalid (or an error) → #/code with a toast; the code screen picks up a one-shot
//   hand-off (codeHandoff.ts) to show the result, and on iOS Safari outside the home-screen app the
//   「コピー → 貼り付け」 notice with a copy button (F11 AC3).
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { isIosSafariNotStandalone, vibrate, writeClipboard } from '../../app/platform';
import { handleDeepLink } from '../../app/unlock';
import { codeErrorMessageJa, displayFromCanonical } from '../../core/codes';
import type { UnlockOutcome } from '../../core/types';
import { useLatest } from '../components/useLatest';
import { useRepo, useUi } from '../context';
import { navigate } from '../router';
import { writeCodeHandoff } from './codeHandoff';
import { errorMessageJa } from './libraryShared';
import './UnlockLanding.css';

export const IOS_COPY_NOTICE = 'ホーム画面のしおり帳で使う場合：合言葉をコピー → しおり帳の『合言葉』で貼り付け';

export function UnlockLanding({ manifestWorkId, code }: { manifestWorkId: string; code: string }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const started = useRef(false);
  const mounted = useRef(false);
  const uiRef = useLatest(ui);

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

    const toCode = (status: 'pending' | 'noMatch' | 'invalid', handoffCode: string) => {
      writeCodeHandoff({ status, code: handoffCode, ios: ios && status !== 'invalid' });
      navigate({ name: 'code' }, { replace: true });
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

    handleDeepLink(repo, manifestWorkId, code).then(
      (outcome) => {
        if (mounted.current) finish(outcome);
      },
      (e: unknown) => {
        if (!mounted.current) return;
        uiRef.current.toast(errorMessageJa(e), { tone: 'danger' });
        toCode('invalid', code);
      },
    );
  }, [repo, manifestWorkId, code, uiRef]);

  return (
    <main className="screen ulp" aria-busy="true">
      <div className="ulp-box" role="status">
        <span className="ulp-spin" aria-hidden="true" />
        <p className="ulp-text">合言葉を確かめています…</p>
      </div>
    </main>
  );
}
