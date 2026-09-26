// In-memory store of the last 点検 (buildAndCheck) per studio project, shared by the 点検 / 書き出し tabs and the
// preview (#/studio/<pid>/preview). A result belongs to the project version it was made from (id + updatedAt),
// so any edit makes it stale. Nothing here is persisted: builds contain no secrets beyond the project itself,
// but they are cheap to redo and must never outlive the edits they describe.
import { useSyncExternalStore } from 'react';
import { assertBuildMatchesProject, buildAndCheck } from '../../../app/studio';
import type { CheckReport } from '../../../app/studio';
import { isShioriError } from '../../../core/errors';
import type { BuildResult, StudioProject } from '../../../core/types';

export interface CheckEntry {
  projectId: string;
  /** project.updatedAt the report was made from */
  updatedAt: number;
  report: CheckReport;
  checkedAt: number;
  /** the creator confirmed the report's warnings (F16 AC3) */
  warningsAcknowledged: boolean;
}

const entries = new Map<string, CheckEntry>();
const inflight = new Map<string, { updatedAt: number; promise: Promise<CheckEntry> }>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCheck(projectId: string): CheckEntry | undefined {
  return entries.get(projectId);
}

/** The entry when it was made from exactly this project version. */
export function freshCheck(project: Pick<StudioProject, 'id' | 'updatedAt'>): CheckEntry | undefined {
  const e = entries.get(project.id);
  return e && e.updatedAt === project.updatedAt ? e : undefined;
}

/**
 * Runs 点検 for this project version, or joins the run already in flight for it. The result replaces the stored
 * entry unless a newer version was checked meanwhile.
 */
export function runCheck(project: StudioProject): Promise<CheckEntry> {
  const running = inflight.get(project.id);
  if (running && running.updatedAt === project.updatedAt) return running.promise;
  const snapshot = project;
  const promise = buildAndCheck(snapshot)
    .then((report) => {
      const entry: CheckEntry = {
        projectId: snapshot.id,
        updatedAt: snapshot.updatedAt,
        report,
        checkedAt: Date.now(),
        warningsAcknowledged: report.warnings.length === 0,
      };
      const current = entries.get(snapshot.id);
      if (!current || current.updatedAt <= entry.updatedAt) entries.set(snapshot.id, entry);
      return entry;
    })
    .finally(() => {
      if (inflight.get(snapshot.id)?.promise === promise) inflight.delete(snapshot.id);
      emit();
    });
  inflight.set(snapshot.id, { updatedAt: snapshot.updatedAt, promise });
  emit();
  return promise;
}

export function acknowledgeWarnings(projectId: string, updatedAt: number, value: boolean): void {
  const e = entries.get(projectId);
  if (!e || e.updatedAt !== updatedAt) return;
  entries.set(projectId, { ...e, warningsAcknowledged: value });
  emit();
}

/** Forgets a project's result (e.g. after the project was deleted). */
export function forgetCheck(projectId: string): void {
  if (entries.delete(projectId)) emit();
}

/** Test helper: empties the store. */
export function resetCheckStore(): void {
  entries.clear();
  inflight.clear();
  emit();
}

/** The stored entry for a project (re-renders when it changes). */
export function useCheckEntry(projectId: string): CheckEntry | undefined {
  return useSyncExternalStore(
    subscribe,
    () => entries.get(projectId),
    () => undefined,
  );
}

/** updatedAt of the check running for the project, or undefined (re-renders when it changes). */
export function useCheckRunning(projectId: string): number | undefined {
  return useSyncExternalStore(
    subscribe,
    () => inflight.get(projectId)?.updatedAt,
    () => undefined,
  );
}

// ───────────────────────── export gate ─────────────────────────

export type ExportGate =
  | { ok: true; build: BuildResult; entry: CheckEntry }
  | { ok: false; reason: string; needsAck?: CheckEntry; entry?: CheckEntry };

/** Whether exporting is allowed now, and why not. */
export function exportGate(project: StudioProject, entry: CheckEntry | undefined): ExportGate {
  if (!entry) return { ok: false, reason: 'まだ点検していません。「点検」タブで点検してください。' };
  if (entry.updatedAt !== project.updatedAt) {
    return { ok: false, reason: '点検のあとで内容が変わりました。もう一度「点検」してください。', entry };
  }
  const build = entry.report.build;
  if (!entry.report.exportable || !build) {
    return { ok: false, reason: '点検でエラーが見つかりました。「点検」タブでエラーを直してください。', entry };
  }
  try {
    assertBuildMatchesProject(project, build);
  } catch (e) {
    return { ok: false, reason: isShioriError(e) ? e.messageJa : '点検のあとで内容が変わりました。もう一度「点検」してください。', entry };
  }
  if (!entry.warningsAcknowledged) {
    return { ok: false, reason: '点検の「注意」を確認してから書き出してください。', needsAck: entry, entry };
  }
  return { ok: true, build, entry };
}
