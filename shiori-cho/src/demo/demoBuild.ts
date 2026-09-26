// Deterministic build of the bundled SFW demo manifests (docs/SPEC.md §4.6, §7.4).
// Shared by scripts/build-demo.ts (writes src/demo/<name>.shiori.json) and demo.test.ts (checks the committed files).
// Not imported by the app: the app imports the generated *.shiori.json files directly.
import { hmacSha256 } from '../core/crypto/primitives';
import { concatBytes, sha256, utf8 } from '../core/encoding';
import type { Rng } from '../core/encoding';
import { ShioriError } from '../core/errors';
import { buildManifest } from '../core/manifest/build';
import { selfTest } from '../core/manifest/selftest';
import type { BuildResult, Bytes, SelfTestReport, StudioProject } from '../core/types';

/** Demo file stems: src/demo/<name>.project.json → src/demo/<name>.shiori.json */
export const DEMO_NAMES = ['hoshiyomi', 'amaoto'] as const;
export type DemoName = (typeof DEMO_NAMES)[number];

/** Bytes one demo build may draw (IVs and anyOf CEKs); the demos need a few hundred. */
export const DEMO_RNG_POOL_BYTES = 4096;

const RNG_LABEL = 'shiori-demo/1|rng|';
const HMAC_BYTES = 32;

/**
 * Deterministic Rng for demo builds only (サークル工房 always uses real randomness).
 *
 * The stream is HMAC-SHA256(key = SHA-256(utf8(JSON.stringify(project))), utf8(label + counter)) blocks, so:
 * - rebuilding an unchanged project gives a byte-identical .shiori.json (no churn in the committed output, and
 *   demo.test.ts can compare a fresh build with the committed file);
 * - any change to the project (text, codes, salt…) gives fresh IVs and CEKs, so an AES-GCM key is never used
 *   with the same IV for a different plaintext;
 * - the key covers the codes and every plaintext, so the stream cannot be predicted without the project.
 * Throws ShioriError('internal') when a build draws more than `poolBytes`.
 */
export async function demoRng(project: StudioProject, poolBytes: number = DEMO_RNG_POOL_BYTES): Promise<Rng> {
  const key = await sha256(utf8(JSON.stringify(project)));
  const blocks: Bytes[] = [];
  for (let i = 0; i * HMAC_BYTES < poolBytes; i++) blocks.push(await hmacSha256(key, utf8(RNG_LABEL + i)));
  const pool = concatBytes(...blocks).slice(0, poolBytes) as Bytes;
  let offset = 0;
  return (n: number): Bytes => {
    if (!Number.isInteger(n) || n < 0 || offset + n > pool.length) {
      throw new ShioriError('internal', 'サンプル用の乱数が足りません（DEMO_RNG_POOL_BYTES を増やしてください）');
    }
    const out = pool.slice(offset, offset + n) as Bytes;
    offset += n;
    return out;
  };
}

export interface DemoBuild {
  build: BuildResult;
  report: SelfTestReport;
  /** exact content of the committed src/demo/<name>.shiori.json */
  text: string;
}

/**
 * buildManifest with the project's fixed kdfSalt and the deterministic demo Rng, then selfTest.
 * Throws ShioriError('validation') if the project has no fixed kdfSalt (tags would change on every build)
 * or is not buildable. The caller decides what to do when `report.ok` is false.
 */
export async function buildDemo(project: StudioProject): Promise<DemoBuild> {
  if (project.kdfSalt === undefined) {
    throw new ShioriError('validation', 'サンプルのプロジェクトには固定の kdfSalt が必要です');
  }
  const build = await buildManifest(project, { rng: await demoRng(project) });
  const report = await selfTest(build.manifest, build.codes, project);
  return { build, report, text: `${build.json}\n` };
}
