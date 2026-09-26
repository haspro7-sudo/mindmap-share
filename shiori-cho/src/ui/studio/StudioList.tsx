// #/studio サークル工房: project list (docs/SPEC.md F16 AC1, AC7, §6). A persistent banner reminds that studio
// data holds secrets. New project, 「サンプルを開く」 (a copy of the bundled 星読みの図書館 project), import of a
// project file (with a secret warning), and per project: open, duplicate, backup and delete.
import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { download, readFileAsText } from '../../app/platform';
import { exportProjectJson, newStudioProject, parseProjectJson } from '../../app/studio';
import { MAX_ISSUES_SHOWN } from '../../core/constants';
import type { StudioProject, ValidationIssue } from '../../core/types';
import hoshiyomiProjectText from '../../demo/hoshiyomi.project.json?raw';
import { EmptyState } from '../components/EmptyState';
import { useSettings, useStudioQuery, useStudioRepo, useUi } from '../context';
import { formatDateJa, formatDateTimeJa } from '../format';
import { hrefFor, navigate } from '../router';
import { forgetCheck } from './tabs/checkStore';
import { MSG_SECRET_BANNER, cloneProject, defaultAppUrl, errorMessageJa, projectDisplayTitle, projectStats } from './tabs/model';
import './Studio.css';

const COPY_SUFFIX = '（コピー）';
const TITLE_MAX = 100;

export function StudioListScreen(): ReactNode {
  const repo = useStudioRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const q = useStudioQuery((r) => r.list(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [importErrors, setImportErrors] = useState<ValidationIssue[] | null>(null);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const createNew = () =>
    run(async () => {
      const p = newStudioProject(defaultAppUrl());
      await repo.put(p);
      navigate({ name: 'studioProject', id: p.id, tab: 'work' });
    });

  const openSample = () =>
    run(async () => {
      const parsed = parseProjectJson(hoshiyomiProjectText);
      if (!parsed.ok) throw new Error('sample project is invalid');
      const now = Date.now();
      const p = cloneProject(parsed.project, now, { appUrl: defaultAppUrl(), lastExportedAt: undefined });
      await repo.put(p);
      ui.toast('サンプル「星読みの図書館」を開きました', { tone: 'ok' });
      navigate({ name: 'studioProject', id: p.id, tab: 'work' });
    });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run(async () => {
      setImportErrors(null);
      const text = await readFileAsText(file);
      const parsed = parseProjectJson(text);
      if (!parsed.ok) {
        setImportErrors(parsed.errors);
        return;
      }
      const ok = await ui.confirm({
        title: 'プロジェクトを読み込みます',
        body: 'このファイルには、合言葉や秘密の内容がすべて含まれています。自分で書き出した控えなど、信頼できるファイルだけを読み込んでください。',
        okLabel: '読み込む',
      });
      if (!ok) return;
      let p = parsed.project;
      const existing = await repo.get(p.id);
      // Never overwrite a project silently: an id that is already here becomes a new copy.
      if (existing) p = cloneProject(p, Date.now());
      await repo.put(p);
      ui.toast(existing ? '同じプロジェクトがあったため、コピーとして読み込みました' : 'プロジェクトを読み込みました', { tone: 'ok' });
      navigate({ name: 'studioProject', id: p.id, tab: 'work' });
    });
  };

  const duplicate = (p: StudioProject) =>
    run(async () => {
      const title = p.work.title === '' ? '' : [...`${p.work.title}${COPY_SUFFIX}`].slice(0, TITLE_MAX).join('');
      const copy = cloneProject(p, Date.now());
      await repo.put({ ...copy, work: { ...copy.work, title } });
      ui.toast('複製しました', { tone: 'ok' });
    });

  const backup = async (p: StudioProject) => {
    const ok = await ui.confirm({
      title: 'プロジェクトの控えを書き出します',
      body: 'このファイルには、合言葉や秘密タイトル、おまけの本文がすべてそのまま入っています。作品に同梱したり、公開したりしないでください。',
      okLabel: '書き出す',
    });
    if (!ok) return;
    download(`project-${p.work.id || 'draft'}.shiori-studio.json`, exportProjectJson(p), 'application/json');
  };

  const remove = async (p: StudioProject) => {
    const ok = await ui.confirm({
      title: `「${projectDisplayTitle(p, settings)}」を削除しますか？`,
      body: '合言葉やおまけの内容も消えます。元に戻せません。先に「控え」を書き出しておくことをおすすめします。',
      okLabel: '削除',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await repo.delete(p.id);
      forgetCheck(p.id);
      ui.toast('削除しました');
    });
  };

  const projects = q.data;

  return (
    <main className="screen stu stu-list" aria-labelledby="stu-list-title">
      <h1 id="stu-list-title" className="stu-title">
        サークル工房
      </h1>
      <p className="banner banner-warn stu-secret" role="note">
        <span aria-hidden="true">🔐</span>
        <span>
          <strong>{MSG_SECRET_BANNER}</strong>
          <span className="stu-secret-sub">この端末の中だけに保存されます。控えは安全な場所に保管してください。</span>
        </span>
      </p>
      <p className="small muted">
        作品に「しおりファイル」を付けるための編集ツールです。合言葉・ヒント・おまけを作り、点検してから同梱用のファイルを書き出せます。
      </p>

      <div className="stu-list-actions">
        <button type="button" className="btn btn-primary" onClick={() => void createNew()} disabled={busy}>
          ＋ 新規作成
        </button>
        <button type="button" className="btn" onClick={() => void openSample()} disabled={busy}>
          サンプルを開く
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          プロジェクトを読み込む
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
      </div>

      {importErrors ? (
        <div className="banner banner-danger stu-import-errors" role="alert">
          <div>
            <p className="stu-issues-title">読み込めませんでした</p>
            <ul>
              {importErrors.slice(0, MAX_ISSUES_SHOWN).map((i, k) => (
                <li key={`${i.path}:${k}`}>
                  {i.path ? <code className="stu-issue-path">{i.path}</code> : null} {i.messageJa}
                </li>
              ))}
            </ul>
            {importErrors.length > MAX_ISSUES_SHOWN ? (
              <p className="small">ほか{importErrors.length - MAX_ISSUES_SHOWN}件</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {settings.discreet.aliasOnly ? (
        <p className="small muted">おしのびモード中のため、作品は表示名（おしのび用）で表示しています。</p>
      ) : null}

      {projects === undefined ? (
        q.error !== undefined ? (
          <EmptyState
            icon="⚠️"
            title="プロジェクトを読み込めませんでした"
            body={errorMessageJa(q.error, 'もう一度お試しください')}
            action={
              <button type="button" className="btn" onClick={q.reload}>
                もう一度読み込む
              </button>
            }
          />
        ) : (
          <p className="muted center" role="status">
            読み込み中…
          </p>
        )
      ) : projects.length === 0 ? (
        <EmptyState icon="🛠️" title="プロジェクトはまだありません" body="「新規作成」か「サンプルを開く」から始めましょう。" />
      ) : (
        <ul className="stu-projects" aria-label="プロジェクト">
          {projects.map((p) => {
            const stats = projectStats(p);
            const name = projectDisplayTitle(p, settings);
            return (
              <li key={p.id} className="card stu-project">
                <a className="stu-project-link" href={hrefFor({ name: 'studioProject', id: p.id, tab: 'work' })}>
                  <span className="stu-project-title">{name}</span>
                  <span className="stu-project-meta small muted">
                    <span className="mono">{p.work.id}</span>
                    <span>
                      目標 {stats.goals}・合言葉 {stats.codeGoals}・おまけ {stats.sealed}
                    </span>
                  </span>
                  <span className="stu-project-meta small muted">
                    <span>更新 {formatDateTimeJa(p.updatedAt)}</span>
                    <span>{p.lastExportedAt !== undefined ? `書き出し ${formatDateJa(p.lastExportedAt)}` : '未書き出し'}</span>
                  </span>
                </a>
                <div className="stu-project-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void duplicate(p)} disabled={busy} aria-label={`「${name}」を複製`}>
                    複製
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void backup(p)} disabled={busy} aria-label={`「${name}」の控えを書き出す`}>
                    控え
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => void remove(p)}
                    disabled={busy}
                    aria-label={`「${name}」を削除`}
                  >
                    削除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
