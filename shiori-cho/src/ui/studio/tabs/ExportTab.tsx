// 工房 › 書き出し tab (docs/SPEC.md F16 AC3, AC6, AC7, §4.4): enabled only when the last 点検 of exactly this
// project version is exportable (warnings acknowledged) and the build still matches the project. Offers the kit
// zip, shiori.json alone, the project backup (secrets!), the ship / never-ship checklist, the store-description
// template and an on-screen code sheet with QR codes.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { download, writeClipboard } from '../../../app/platform';
import {
  assertBuildMatchesProject,
  exportKitZip,
  exportProjectJson,
  kitZipFileName,
  markExported,
  projectBackupFileName,
  withBuildSalt,
} from '../../../app/studio';
import { MANIFEST_FILE_NAME } from '../../../core/constants';
import { KIT_PATHS, KIT_QR_DIR, kitHasAppUrl, storeTemplateJa } from '../../../core/kit';
import type { BuildResult, StudioProject } from '../../../core/types';
import { useUi } from '../../context';
import { formatDateTimeJa } from '../../format';
import { navigate } from '../../router';
import { QrCode } from '../QrCode';
import { renderQrPng } from '../qrPng';
import { acknowledgeWarnings, exportGate, useCheckEntry } from './checkStore';
import type { ExportGate } from './checkStore';
import { errorMessageJa } from './model';
import type { StudioTabProps } from './model';

export interface ExportTabProps extends StudioTabProps {
  flush(): Promise<void>;
}

export function ExportTab({ project, update, flush }: ExportTabProps): ReactNode {
  const ui = useUi();
  const entry = useCheckEntry(project.id);
  const gate = exportGate(project, entry);
  const [busy, setBusy] = useState<'kit' | 'json' | 'project' | null>(null);
  const ackId = useId();

  const markDone = (build: BuildResult) => {
    update((p) => markExported(p, build), { edit: false, immediate: true });
  };

  const downloadKit = async () => {
    if (!gate.ok || busy) return;
    setBusy('kit');
    try {
      const zip = await exportKitZip(project, gate.build, renderQrPng);
      download(kitZipFileName(project), new Blob([new Uint8Array(zip)], { type: 'application/zip' }));
      markDone(gate.build);
      ui.toast('キットを書き出しました', { tone: 'ok' });
    } catch (e) {
      ui.toast(errorMessageJa(e, 'キットを書き出せませんでした'), { tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const downloadJson = () => {
    if (!gate.ok || busy) return;
    try {
      assertBuildMatchesProject(project, gate.build);
      download(MANIFEST_FILE_NAME, gate.build.json, 'application/json');
      markDone(gate.build);
      ui.toast('shiori.json を書き出しました', { tone: 'ok' });
    } catch (e) {
      ui.toast(errorMessageJa(e, '書き出せませんでした'), { tone: 'danger' });
    }
  };

  const downloadProject = async () => {
    if (busy) return;
    const ok = await ui.confirm({
      title: 'プロジェクトの控えを書き出します',
      body: 'このファイルには、合言葉や秘密タイトル、おまけの本文がすべてそのまま入っています。作品に同梱したり、公開したりしないでください。安全な場所に保管してください。',
      okLabel: '書き出す',
    });
    if (!ok) return;
    setBusy('project');
    try {
      // Keep the salt of a matching build in the backup, so a restored project keeps its tags.
      const matching = gate.ok ? gate.build : undefined;
      const snapshot = matching ? withBuildSalt(project, matching) : project;
      if (matching && snapshot !== project) update((p) => withBuildSalt(p, matching), { edit: false, immediate: true });
      await flush();
      download(projectBackupFileName(), exportProjectJson(snapshot), 'application/json');
      ui.toast('プロジェクトの控えを書き出しました', { tone: 'ok' });
    } catch (e) {
      ui.toast(errorMessageJa(e, '書き出せませんでした'), { tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const template = storeTemplateJa(project);
  const copyTemplate = async () => {
    const ok = await writeClipboard(template);
    ui.toast(ok ? 'コピーしました' : 'コピーできませんでした。文章を長押しして選んでください', { tone: ok ? 'ok' : 'danger' });
  };

  return (
    <div className="stack stu-tab">
      <section className="card-flat stack" aria-labelledby="stu-export">
        <h2 id="stu-export" className="stu-h2">
          書き出し
        </h2>
        {gate.ok ? (
          <p className="banner banner-ok" role="status">
            <span aria-hidden="true">✓</span>
            <span>
              点検済みです（{formatDateTimeJa(gate.entry.checkedAt)}）。
              {project.lastExportedAt !== undefined ? `前回の書き出し：${formatDateTimeJa(project.lastExportedAt)}` : ''}
            </span>
          </p>
        ) : (
          <div className="banner banner-warn stu-gate" role="status">
            <span aria-hidden="true">🔒</span>
            <span>{gate.reason}</span>
          </div>
        )}
        {!gate.ok && !gate.needsAck ? (
          <div className="row-wrap">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => navigate({ name: 'studioProject', id: project.id, tab: 'check' }, { replace: true })}
            >
              「点検」タブへ
            </button>
          </div>
        ) : null}

        {gate.entry && gate.entry.updatedAt === project.updatedAt && gate.entry.report.warnings.length > 0 && gate.entry.report.exportable ? (
          <div className="stu-ack">
            <p className="small">点検で「注意」が{gate.entry.report.warnings.length}件ありました：</p>
            <ul className="stu-ack-list small">
              {gate.entry.report.warnings.map((w, k) => (
                <li key={`${w.path}:${w.code}:${k}`}>{w.messageJa}</li>
              ))}
            </ul>
            <label className="stu-check" htmlFor={ackId}>
              <input
                id={ackId}
                type="checkbox"
                checked={gate.entry.warningsAcknowledged}
                onChange={(e) => acknowledgeWarnings(project.id, project.updatedAt, e.target.checked)}
              />
              <span className="stu-check-text">注意の内容を確認しました</span>
            </label>
          </div>
        ) : null}

        <div className="stu-export-actions">
          <button type="button" className="btn btn-primary btn-block" disabled={!gate.ok || busy !== null} onClick={() => void downloadKit()}>
            {busy === 'kit' ? <span className="stu-spinner" aria-hidden="true" /> : <span aria-hidden="true">📦</span>}
            キットをダウンロード（zip）
          </button>
          <button type="button" className="btn btn-block" disabled={!gate.ok || busy !== null} onClick={downloadJson}>
            <span aria-hidden="true">📄</span> shiori.json だけ
          </button>
          <button type="button" className="btn btn-block" disabled={busy !== null} onClick={() => void downloadProject()}>
            <span aria-hidden="true">🗄️</span> プロジェクトの控え（秘密を含む）
          </button>
        </div>
        <p className="small muted">
          キットには、同梱用のしおりファイル・はじめに.txt、作中に埋め込む合言葉の一覧とQRコード画像、プロジェクトの控えが入っています。
          {kitHasAppUrl(project.appUrl) ? '' : '（アプリのURLが未設定のため、QRコード画像は入りません）'}
        </p>
      </section>

      <ShipChecklist />

      <section className="card-flat stack" aria-labelledby="stu-template">
        <h2 id="stu-template" className="stu-h2">
          告知文テンプレート
        </h2>
        <p className="stu-template" id="stu-template-text">
          {template}
        </p>
        <div className="row-wrap">
          <button type="button" className="btn btn-sm" onClick={() => void copyTemplate()} aria-describedby="stu-template-text">
            コピー
          </button>
        </div>
        <p className="small muted">
          作品ページで外部ツールやURLに触れる前に、DLsiteの作品登録ルールをご確認ください。しおり帳は、作中にURLを書かなくても合言葉だけで使えます。
        </p>
      </section>

      <CodeSheet gate={gate} project={project} />
    </div>
  );
}

function FileList({ files }: { files: ReadonlyArray<readonly [string, string]> }): ReactNode {
  return (
    <ul className="stu-files">
      {files.map(([path, note]) => (
        <li key={path}>
          <code className="stu-path">{path}</code>
          <span className="small muted">{note}</span>
        </li>
      ))}
    </ul>
  );
}

function ShipChecklist(): ReactNode {
  const ship: ReadonlyArray<readonly [string, string]> = [
    [KIT_PATHS.shioriJson, 'しおりファイル（合言葉で開く部分は暗号化済み）'],
    [KIT_PATHS.readmePlayer, 'プレイヤー向けの使い方'],
  ];
  const secret: ReadonlyArray<readonly [string, string]> = [
    [KIT_PATHS.codesCsv, 'すべての合言葉の一覧'],
    [`${KIT_QR_DIR}/`, '合言葉のQRコード画像（作中の表示場面にだけ使う）'],
    [KIT_PATHS.snippets, '制作ツール別の表示例（合言葉を含む）'],
    [KIT_PATHS.projectBackup, 'プロジェクトの控え（秘密をすべて含む）'],
  ];
  const local: ReadonlyArray<readonly [string, string]> = [
    [KIT_PATHS.storeTemplate, '告知文のひな形（秘密なし。文章は作品ページにそのまま使えます）'],
    [KIT_PATHS.readmeCreator, 'このチェックリスト'],
  ];
  return (
    <section className="card-flat stack" aria-labelledby="stu-ship">
      <h2 id="stu-ship" className="stu-h2">
        同梱するもの・しないもの
      </h2>
      <div className="stu-ship">
        <h3 className="stu-h3 stu-ship-ok">
          <span aria-hidden="true">✓ </span>作品に同梱する（公開してよい）
        </h3>
        <FileList files={ship} />
      </div>
      <div className="stu-ship">
        <h3 className="stu-h3 stu-ship-ng">
          <span aria-hidden="true">✗ </span>絶対に同梱・公開しない（秘密を含む）
        </h3>
        <FileList files={secret} />
      </div>
      <div className="stu-ship">
        <h3 className="stu-h3">
          <span aria-hidden="true">– </span>作品のzipには入れない（手元用）
        </h3>
        <FileList files={local} />
      </div>
      <p className="small muted">合言葉による封印はネタバレ防止のしくみで、コピー防止（DRM）ではありません。有料の本編をおまけに入れないでください。</p>
    </section>
  );
}

function CodeSheet({ gate, project }: { gate: ExportGate; project: StudioProject }): ReactNode {
  const build = gate.ok ? gate.build : undefined;
  const withQr = kitHasAppUrl(project.appUrl);
  return (
    <section className="card-flat stack" aria-labelledby="stu-codes">
      <div className="row">
        <h2 id="stu-codes" className="stu-h2">
          合言葉シート
        </h2>
        <span className="badge badge-ok stu-vis">
          <span aria-hidden="true">🔒</span>秘密
        </span>
      </div>
      {!build ? (
        <p className="small muted">点検が済むと、ここで合言葉とQRコードを確かめられます。</p>
      ) : build.codes.length === 0 ? (
        <p className="small muted">合言葉つきの目標はありません。</p>
      ) : (
        <details className="stu-codes-details">
          <summary className="stu-adv-summary">合言葉とQRコードを表示（{build.codes.length}件）</summary>
          <p className="small muted">
            {withQr
              ? `画面のQRコードをスマホのカメラで読み取ると、動作を確かめられます（読み取り先：${project.appUrl}）。`
              : 'アプリのURLが未設定のため、QRコードはありません。「作品」タブでURLを設定してください。'}
          </p>
          <ul className="stu-codes">
            {build.codes.map((row) => (
              <li key={row.goalId} className="stu-code-row">
                <div className="stu-code-info">
                  <p className="stu-code-goal">
                    <strong>{row.label}</strong>
                    <span className="small muted mono"> {row.goalId}</span>
                  </p>
                  <p className="small">秘密タイトル：{row.secretTitle}</p>
                  <p className="stu-code-value mono">{row.display}</p>
                  <p className="small muted">{row.codeKind === 'kana' ? 'ひらがな5語' : '英数字'}</p>
                </div>
                {withQr ? (
                  <QrCode text={row.unlockUrl} label={`「${row.label}」の合言葉のQRコード`} size={132} className="stu-code-qr" />
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
