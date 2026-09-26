// STUB (contract) — creator editor services. docs/SPEC.md F16.
import type { BuildResult, SelfTestReport, StudioProject, ValidationIssue } from '../core/types';
import type { Rng } from '../core/encoding';

export interface CheckReport {
  build?: BuildResult;
  /** errors from build/validate/lint/noSpoil */
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  selfTest?: SelfTestReport;
  leaks: string[];
  /** true iff no errors and selfTest.ok */
  exportable: boolean;
}
export declare function newStudioProject(appUrl: string, now?: number, rng?: Rng): StudioProject;
/** build → validate → selfTest → lint → noSpoil. Persist returned build.salt into project.kdfSalt. */
export declare function buildAndCheck(project: StudioProject): Promise<CheckReport>;
/** Zip (fflate) of kit text files + QR PNGs (qr/<goalId>.png, rendered by the provided renderer). */
export declare function exportKitZip(
  project: StudioProject,
  build: BuildResult,
  renderQrPng: (url: string, caption: string) => Promise<Uint8Array>,
): Promise<Uint8Array>;
export declare function exportProjectJson(project: StudioProject): string;
export declare function parseProjectJson(text: string): { ok: true; project: StudioProject } | { ok: false; errors: ValidationIssue[] };
