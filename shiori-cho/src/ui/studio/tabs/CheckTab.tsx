// 工房 › 点検 tab (docs/SPEC.md F16 AC3–AC5): runs buildAndCheck (build → validate → self-test → no-spoil
// guard; PBKDF2 makes it take a moment), shows errors / warnings with their paths, the self-test checklist and
// the leak report, and opens 「プレイヤー画面で試す」 (#/studio/<pid>/preview) with the last build.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { utf8ByteLength } from '../../../core/manifest/validate';
import type { ValidationIssue } from '../../../core/types';
import { formatDateTimeJa } from '../../format';
import { navigate } from '../../router';
import { useCheckEntry, useCheckRunning } from './checkStore';
import { tabForPath } from './model';
import type { StudioTabProps } from './model';

const TAB_LABEL = { work: '作品', structure: '章・グループ', goals: '目標', extras: 'おまけ' } as const;

export interface CheckTabProps extends StudioTabProps {
  /** runs 点検 for the current project and stores the salt (see StudioProject) */
  onRunCheck(): Promise<void>;
  /** saves pending edits (before leaving for the preview) */
  flush(): Promise<void>;
}

export function CheckTab({ project, onRunCheck, flush }: CheckTabProps): ReactNode {
  const entry = useCheckEntry(project.id);
  const running = useCheckRunning(project.id);
  const busy = running !== undefined;
  const resultRef = useRef<HTMLDivElement>(null);
  const wasBusy = useRef(busy);

  // Move focus to the result summary when a run finishes (screen readers hear the outcome).
  useEffect(() => {
    if (wasBusy.current && !busy) resultRef.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  const fresh = entry !== undefined && entry.updatedAt === project.updatedAt;
  const report = entry?.report;
  const build = report?.build;

  const openPreview = async () => {
    await flush();
    navigate({ name: 'studioPreview', id: project.id });
  };

  return (
    <div className="stack stu-tab">
      <section className="card-flat stack" aria-labelledby="stu-check">
        <h2 id="stu-check" className="stu-h2">
          点検
        </h2>
        <p className="field-hint">
          しおりファイルを実際に作り、合言葉で開けるか、秘密が公開部分に漏れていないかを確かめます。合言葉の鍵の計算に数秒かかることがあります。
        </p>
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" onClick={() => void onRunCheck()} disabled={busy} aria-busy={busy || undefined}>
            {busy ? (
              <>
                <span className="stu-spinner" aria-hidden="true" />
                点検中…
              </>
            ) : entry ? (
              'もう一度点検する'
            ) : (
              '点検する'
            )}
          </button>
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">
          {busy ? '点検中です。しばらくお待ちください' : ''}
        </p>
        {busy ? (
          <div className="stu-progress" aria-hidden="true">
            <div className="stu-progress-bar" />
          </div>
        ) : null}
      </section>

      {entry && report ? (
        <div className="stack" ref={resultRef} tabIndex={-1} aria-label="点検の結果" role="region">
          {!fresh ? (
            <p className="banner banner-warn" role="note">
              <span aria-hidden="true">🕒</span>
              <span>前回の点検のあとで内容が変わりました。書き出す前に、もう一度点検してください。</span>
            </p>
          ) : null}

          {report.exportable ? (
            <div className="banner banner-ok stu-summary">
              <span aria-hidden="true" className="stu-summary-icon">
                ✓
              </span>
              <span>
                <strong>書き出せます</strong>
                {report.warnings.length > 0 ? `（注意 ${report.warnings.length}件：書き出しの前に確認が必要です）` : ''}
              </span>
            </div>
          ) : (
            <div className="banner banner-danger stu-summary">
              <span aria-hidden="true" className="stu-summary-icon">
                ！
              </span>
              <span>
                <strong>{report.errors.length > 0 ? `エラーが${report.errors.length}件あります` : '動作テストに失敗しました'}</strong>
                。直してから、もう一度点検してください。
              </span>
            </div>
          )}
          <p className="small muted">点検した日時：{formatDateTimeJa(entry.checkedAt)}</p>

          <IssueSection title="エラー" tone="error" issues={report.errors} projectId={project.id} />
          <IssueSection title="注意" tone="warning" issues={report.warnings} projectId={project.id} />

          <section className="card-flat stack-sm" aria-labelledby="stu-selftest">
            <h3 id="stu-selftest" className="stu-h3">
              動作テスト
            </h3>
            {report.selfTest ? (
              <ul className="stu-checklist">
                {report.selfTest.checks.map((c) => (
                  <li key={c.id} className={c.ok ? 'is-ok' : 'is-ng'}>
                    <span className="stu-check-mark" aria-hidden="true">
                      {c.ok ? '✓' : '✗'}
                    </span>
                    <span className="visually-hidden">{c.ok ? '成功：' : '失敗：'}</span>
                    <span>{c.messageJa}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">エラーを直すと、しおりファイルを作って動作を確かめます。</p>
            )}
          </section>

          <section className="card-flat stack-sm" aria-labelledby="stu-leaks">
            <h3 id="stu-leaks" className="stu-h3">
              秘密の漏れ
            </h3>
            {!build ? (
              <p className="small muted">しおりファイルを作れたあとで確かめます。</p>
            ) : report.leaks.length === 0 ? (
              <p className="stu-ok-line">
                <span aria-hidden="true">✓ </span>公開用のしおりファイルに、合言葉や秘密の内容は含まれていません。
              </p>
            ) : (
              <p className="field-error">
                公開用のしおりファイルに、秘密の内容が{report.leaks.length}件含まれています。上の「エラー」を見て、公開される欄から取り除いてください。
              </p>
            )}
          </section>

          {build ? (
            <section className="card-flat stack-sm" aria-labelledby="stu-build">
              <h3 id="stu-build" className="stu-h3">
                できあがったしおりファイル
              </h3>
              <p className="small">
                shiori.json：{Math.max(1, Math.ceil(utf8ByteLength(build.json) / 1024))}KB・目標 {build.manifest.goals.length}・合言葉{' '}
                {build.codes.length}・おまけ {build.manifest.sealed.length}
              </p>
              <div className="row-wrap">
                <button type="button" className="btn" onClick={() => void openPreview()}>
                  <span aria-hidden="true">▶</span> プレイヤー画面で試す
                </button>
                {fresh && report.exportable ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => navigate({ name: 'studioProject', id: project.id, tab: 'export' }, { replace: true })}
                  >
                    書き出しへ進む
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      ) : !busy ? (
        <p className="small muted">まだ点検していません。</p>
      ) : null}
    </div>
  );
}

function IssueSection(props: {
  title: string;
  tone: 'error' | 'warning';
  issues: readonly ValidationIssue[];
  projectId: string;
}): ReactNode {
  const { title, tone, issues, projectId } = props;
  if (issues.length === 0) return null;
  return (
    <section className={`card-flat stack-sm stu-issue-sec is-${tone}`} aria-labelledby={`stu-issues-${tone}`}>
      <h3 id={`stu-issues-${tone}`} className="stu-h3">
        {title}（{issues.length}件）
      </h3>
      <ul className="stu-issue-list">
        {issues.map((i, k) => {
          const tab = tabForPath(i.path);
          return (
            <li key={`${i.path}:${i.code}:${k}`}>
              <span className="visually-hidden">{tone === 'error' ? 'エラー：' : '注意：'}</span>
              <span className="stu-issue-msg">{i.messageJa}</span>
              <span className="stu-issue-meta">
                {i.path ? <code className="stu-issue-path">{i.path}</code> : null}
                {tab ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost stu-issue-go"
                    onClick={() => navigate({ name: 'studioProject', id: projectId, tab }, { replace: true })}
                  >
                    {TAB_LABEL[tab]}タブへ
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
