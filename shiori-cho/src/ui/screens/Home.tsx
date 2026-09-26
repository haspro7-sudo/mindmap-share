// #/ 本棚 (docs/SPEC.md F4, F15 AC5 banner, F4 AC5 pending banner, F13 AC3 resume card, F17 AC1).
// One repository query loads works, their manifests and progress, sessions and pending codes.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { shouldRemindBackup, snoozeBackupReminder } from '../../app/backup';
import { startSession } from '../../app/sessions';
import { isShioriError } from '../../core/errors';
import { computeProgress } from '../../core/progress';
import { daysSince, resumeInfo, resumeLabelJa } from '../../core/session';
import type { Session, Settings, WorkRecord, WorkStatus } from '../../core/types';
import type { ShioriRepo } from '../../storage/repo';
import { EmojiCover } from '../components/EmojiCover';
import { EmptyState } from '../components/EmptyState';
import { ProgressBar } from '../components/Progress';
import { useRepo, useRepoQuery, useSettings, useUi } from '../context';
import { STATUS_LABEL, STATUS_ORDER, displayTitle } from '../format';
import { hrefFor, navigate } from '../router';
import { errorMessageJa, useTrySamples } from './libraryShared';
import './Home.css';

// ───────────────────────── data ─────────────────────────

interface LibraryItem {
  work: WorkRecord;
  /** overall progress %, present only when the work has a manifest */
  pct?: number;
  /** last time played: lastPlayedAt, or the start of the session that is open right now */
  lastActive?: number;
  recording: boolean;
}

interface ResumeCard {
  item: LibraryItem;
  session: Session;
  checkpointLabel?: string;
  days: number;
}

interface LibraryData {
  items: LibraryItem[];
  pendingCount: number;
  openSession?: Session;
  resume?: ResumeCard;
  now: number;
}

async function loadLibrary(repo: ShioriRepo): Promise<LibraryData> {
  const [works, manifests, sessions, pending, openSession] = await Promise.all([
    repo.listWorks(),
    repo.listManifests(),
    repo.listSessions(),
    repo.listPending(),
    repo.getOpenSession(),
  ]);
  const now = Date.now();
  const manifestByKey = new Map(manifests.map((m) => [m.key, m.manifest]));

  const items = await Promise.all(
    works.map(async (work): Promise<LibraryItem> => {
      const recording = openSession !== undefined && openSession.workId === work.id;
      const lastActive =
        openSession !== undefined && openSession.workId === work.id
          ? Math.max(work.lastPlayedAt ?? 0, openSession.startedAt)
          : work.lastPlayedAt;
      const item: LibraryItem = { work, recording };
      if (lastActive !== undefined) item.lastActive = lastActive;
      const manifest = work.manifestKey ? manifestByKey.get(work.manifestKey) : undefined;
      if (manifest) item.pct = computeProgress(manifest, await repo.listProgress(work.id)).pct;
      return item;
    }),
  );

  const data: LibraryData = { items, pendingCount: pending.length, now };
  if (openSession) data.openSession = openSession;

  const byId = new Map(items.map((i) => [i.work.id, i]));
  // Sessions of deleted works are gone (deleteWork cascades); skip any stray one anyway.
  const last = resumeInfo(sessions.filter((s) => byId.has(s.workId)));
  const item = last ? byId.get(last.workId) : undefined;
  if (last && item) {
    const manifest = item.work.manifestKey ? manifestByKey.get(item.work.manifestKey) : undefined;
    const checkpointLabel = last.checkpointId
      ? manifest?.checkpoints.find((c) => c.id === last.checkpointId)?.label
      : undefined;
    const resume: ResumeCard = { item, session: last, days: daysSince(last.endedAt ?? last.startedAt, now) };
    if (checkpointLabel !== undefined) resume.checkpointLabel = checkpointLabel;
    data.resume = resume;
  }
  return data;
}

// ───────────────────────── filter & sort ─────────────────────────

type Filter = 'all' | WorkStatus;
type SortKey = 'recent' | 'added' | 'name';

const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'recent', label: '最近遊んだ順' },
  { key: 'added', label: '追加順' },
  { key: 'name', label: '名前順' },
];

const VIEW_KEY = 'shiori.home.view';

/** The filter and sort survive navigation within the tab (sessionStorage; never titles, only two keys). */
function readView(): { filter: Filter; sort: SortKey } {
  const fallback = { filter: 'all' as Filter, sort: 'recent' as SortKey };
  try {
    const raw = window.sessionStorage.getItem(VIEW_KEY);
    if (!raw) return fallback;
    const v = JSON.parse(raw) as { filter?: unknown; sort?: unknown };
    const filter = v.filter === 'all' || (STATUS_ORDER as readonly unknown[]).includes(v.filter) ? (v.filter as Filter) : 'all';
    const sort = SORT_OPTIONS.some((o) => o.key === v.sort) ? (v.sort as SortKey) : 'recent';
    return { filter, sort };
  } catch {
    return fallback;
  }
}

function writeView(view: { filter: Filter; sort: SortKey }): void {
  try {
    window.sessionStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // storage unavailable: the view simply resets next time
  }
}

const collator = new Intl.Collator('ja', { numeric: true });

function sortItems(items: readonly LibraryItem[], sort: SortKey, settings: Pick<Settings, 'discreet'>): LibraryItem[] {
  const newestFirst = (a: LibraryItem, b: LibraryItem) => b.work.createdAt - a.work.createdAt;
  const out = [...items];
  switch (sort) {
    case 'recent':
      out.sort((a, b) => {
        const la = a.lastActive ?? -Infinity;
        const lb = b.lastActive ?? -Infinity;
        return la === lb ? newestFirst(a, b) : lb - la;
      });
      break;
    case 'added':
      out.sort(newestFirst);
      break;
    case 'name':
      out.sort((a, b) => collator.compare(displayTitle(a.work, settings), displayTitle(b.work, settings)) || newestFirst(a, b));
      break;
  }
  return out;
}

function lastPlayedLabel(ts: number, now: number): string {
  const d = daysSince(ts, now);
  if (d === 0) return '今日';
  if (d === 1) return '昨日';
  return `${d}日前`;
}

const STATUS_BADGE: Record<WorkStatus, string> = {
  backlog: 'badge',
  playing: 'badge badge-accent',
  cleared: 'badge badge-ok',
  completed: 'badge badge-ok',
  paused: 'badge',
};

// ───────────────────────── screen ─────────────────────────

export function HomeScreen(): ReactNode {
  const { settings } = useSettings();
  const q = useRepoQuery(loadLibrary, []);
  const [view, setView] = useState(readView);

  useEffect(() => writeView(view), [view]);

  const data = q.data;
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, backlog: 0, playing: 0, cleared: 0, completed: 0, paused: 0 };
    for (const i of data?.items ?? []) {
      c.all++;
      c[i.work.status]++;
    }
    return c;
  }, [data]);

  const visible = useMemo(() => {
    const items = (data?.items ?? []).filter((i) => view.filter === 'all' || i.work.status === view.filter);
    return sortItems(items, view.sort, settings);
  }, [data, view, settings]);

  if (!data) {
    return (
      <main className="screen home">
        <h1 className="home-title">本棚</h1>
        {q.error ? (
          <div className="stack">
            <p role="alert">本棚を読み込めませんでした。</p>
            <button type="button" className="btn" onClick={q.reload}>
              もう一度読み込む
            </button>
          </div>
        ) : (
          <p className="muted" role="status">
            読み込み中…
          </p>
        )}
      </main>
    );
  }

  const empty = data.items.length === 0;

  return (
    <main className="screen home">
      <h1 className="home-title">本棚</h1>

      <HomeBanners hasData={!empty || data.pendingCount > 0} pendingCount={data.pendingCount} now={data.now} />

      {empty ? (
        <HomeEmpty />
      ) : (
        <>
          {data.resume ? <ResumeSection resume={data.resume} openSession={data.openSession} /> : null}

          <section className="home-library" aria-labelledby="home-list-title">
            <div className="home-toolbar">
              <h2 id="home-list-title" className="home-list-title">
                作品<span className="home-count">{counts.all}</span>
              </h2>
              <label className="home-sort">
                <span className="visually-hidden">並び順</span>
                <select
                  className="select home-sort-select"
                  value={view.sort}
                  onChange={(e) => setView((v) => ({ ...v, sort: e.target.value as SortKey }))}
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="home-chips" role="group" aria-label="状態で絞り込む">
              {(['all', ...STATUS_ORDER] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className="chip home-chip"
                  aria-pressed={view.filter === f}
                  onClick={() => setView((v) => ({ ...v, filter: f }))}
                >
                  <span>{f === 'all' ? 'すべて' : STATUS_LABEL[f]}</span>
                  <span className="home-chip-count">{counts[f]}</span>
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="home-none muted">この状態の作品はありません。</p>
            ) : (
              <ul className="home-list" aria-labelledby="home-list-title">
                {visible.map((item) => (
                  <li key={item.work.id}>
                    <WorkCard item={item} now={data.now} settings={settings} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <a className="btn btn-primary home-fab" href={hrefFor({ name: 'add' })}>
        <span aria-hidden="true" className="home-fab-plus">
          ＋
        </span>
        <span>追加</span>
      </a>
    </main>
  );
}

// ───────────────────────── parts ─────────────────────────

function HomeBanners({ hasData, pendingCount, now }: { hasData: boolean; pendingCount: number; now: number }): ReactNode {
  const { settings } = useSettings();
  const repo = useRepo();
  const ui = useUi();
  const remind = shouldRemindBackup(settings, hasData, now);
  if (!remind && pendingCount === 0) return null;

  const snooze = async () => {
    try {
      await snoozeBackupReminder(repo);
      ui.toast('7日後にまたお知らせします');
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
    }
  };

  return (
    <div className="home-banners">
      {pendingCount > 0 ? (
        <a className="banner home-banner home-banner-link" href={hrefFor({ name: 'code' })}>
          <span aria-hidden="true" className="home-banner-icon">
            🔑
          </span>
          <span className="home-banner-text">保留中の合言葉があります（{pendingCount}件）</span>
          <span aria-hidden="true" className="home-banner-chev">
            ›
          </span>
        </a>
      ) : null}
      {remind ? (
        <section className="banner banner-warn home-banner home-backup" aria-label="バックアップのおすすめ">
          <span aria-hidden="true" className="home-banner-icon">
            💾
          </span>
          <div className="home-backup-body">
            <p className="home-backup-text">
              {settings.lastBackupAt === undefined
                ? 'まだバックアップがありません。機種変更や削除に備えて、保存しておきましょう。'
                : '前回のバックアップから時間がたっています。最新の状態を保存しておきましょう。'}
            </p>
            <div className="home-backup-actions">
              <a className="btn btn-sm btn-primary" href={hrefFor({ name: 'settings' })}>
                バックアップする
              </a>
              <button type="button" className="btn btn-sm" onClick={() => void snooze()}>
                7日後に
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function HomeEmpty(): ReactNode {
  const trySamples = useTrySamples();
  const [busy, setBusy] = useState(false);
  const onSamples = async () => {
    setBusy(true);
    await trySamples();
    setBusy(false);
  };
  return (
    <div className="card-flat home-empty">
      <EmptyState
        icon="🔖"
        title="本棚はまだ空です"
        body={'遊んでいる作品を追加すると、進み具合や前回の続きを記録できます。\nまずはサンプルで試すこともできます。'}
        action={
          <>
            <button type="button" className="btn" onClick={() => void onSamples()} disabled={busy} aria-busy={busy}>
              サンプルを試す
            </button>
            <a className="btn btn-primary" href={hrefFor({ name: 'add' })}>
              作品を追加
            </a>
          </>
        }
      />
    </div>
  );
}

function ResumeSection({ resume, openSession }: { resume: ResumeCard; openSession?: Session }): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const { item, session, checkpointLabel, days } = resume;
  const workId = item.work.id;
  const recordingHere = openSession?.workId === workId;
  const workRoute = { name: 'work', id: workId, tab: 'progress' } as const;

  const onStart = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await startSession(repo, workId);
      ui.toast('記録を始めました', { tone: 'ok' });
      navigate(workRoute);
    } catch (e) {
      ui.toast(errorMessageJa(e), { tone: 'danger' });
      // The same work is already being recorded: take the player there anyway.
      if (isShioriError(e) && e.code === 'conflict' && (await repo.getOpenSession())?.workId === workId) navigate(workRoute);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const where = session.whereNote?.trim();
  const next = session.nextTodo?.trim();

  return (
    <section className="card home-resume" aria-labelledby="home-resume-title">
      <div className="home-resume-head">
        <h2 id="home-resume-title" className="home-resume-kicker">
          前回の続き（{resumeLabelJa(days)}）
        </h2>
      </div>
      <a className="home-resume-work" href={hrefFor(workRoute)}>
        <EmojiCover emoji={item.work.coverEmoji} color={item.work.coverColor} size={40} />
        <span className="home-resume-name">{displayTitle(item.work, settings)}</span>
      </a>
      {checkpointLabel || where || next ? (
        <dl className="home-resume-info">
          {checkpointLabel ? (
            <div>
              <dt>現在地</dt>
              <dd>{checkpointLabel}</dd>
            </div>
          ) : null}
          {where ? (
            <div>
              <dt>どこまで</dt>
              <dd>{where}</dd>
            </div>
          ) : null}
          {next ? (
            <div>
              <dt>次にやること</dt>
              <dd>{next}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {recordingHere ? (
        <a className="btn btn-block home-resume-btn" href={hrefFor(workRoute)}>
          記録中の作品を開く
        </a>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-block home-resume-btn"
          onClick={() => void onStart()}
          disabled={busy}
          aria-busy={busy}
        >
          <span aria-hidden="true">▶</span>
          <span>続きを始める</span>
        </button>
      )}
    </section>
  );
}

function WorkCard({ item, now, settings }: { item: LibraryItem; now: number; settings: Settings }): ReactNode {
  const { work, pct, recording, lastActive } = item;
  const isNew = work.newGoalIds.length > 0;
  return (
    <a className="card home-card" href={hrefFor({ name: 'work', id: work.id, tab: 'progress' })}>
      <EmojiCover emoji={work.coverEmoji} color={work.coverColor} size={52} />
      <div className="home-card-body">
        <div className="home-card-top">
          <span className="home-card-title">{displayTitle(work, settings)}</span>
          {isNew ? <span className="badge badge-accent home-card-new">NEW</span> : null}
        </div>
        <div className="home-card-meta">
          <span className={STATUS_BADGE[work.status]}>{STATUS_LABEL[work.status]}</span>
          {recording ? <span className="badge badge-warn">記録中</span> : null}
          {lastActive !== undefined && !recording ? (
            <span className="home-card-last">
              <span className="visually-hidden">最後に遊んだ日：</span>
              {lastPlayedLabel(lastActive, now)}
            </span>
          ) : null}
        </div>
        {pct !== undefined ? (
          <div className="home-card-progress">
            <ProgressBar pct={pct} compact label="進捗" />
          </div>
        ) : null}
      </div>
    </a>
  );
}
