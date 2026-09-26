/**
 * Builds the bundled SFW demo manifests (docs/SPEC.md §4.6, §7.4, F17):
 *   src/demo/<name>.project.json → lint → buildManifest (fixed kdfSalt) → selfTest → src/demo/<name>.shiori.json
 *
 * Run: `npm run demo:build` (tsx, Node 22 WebCrypto). Commit the generated *.shiori.json files.
 * IVs come from a deterministic, content-keyed stream (src/demo/demoBuild.ts), so rebuilding an unchanged project
 * reproduces the committed file byte for byte. Exits 1 if any project fails the checks or the self-test.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isShioriError } from '../src/core/errors';
import { lintProject } from '../src/core/manifest/lint';
import { studioProjectSchema } from '../src/core/manifest/schema';
import type { StudioProject } from '../src/core/types';
import { buildDemo, DEMO_NAMES } from '../src/demo/demoBuild';

const DEMO_DIR = new URL('../src/demo/', import.meta.url);

/** Any "storeCode" key anywhere in a JSON value (the demos must have no store codes, F17 AC4). */
function hasStoreCode(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasStoreCode);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([k, v]) => k === 'storeCode' || k === 'storeLink' || hasStoreCode(v));
}

function describeError(e: unknown): string {
  if (isShioriError(e)) return e.messageJa;
  return e instanceof Error ? e.message : String(e);
}

async function buildOne(name: string): Promise<boolean> {
  const projectPath = fileURLToPath(new URL(`${name}.project.json`, DEMO_DIR));
  const outPath = fileURLToPath(new URL(`${name}.shiori.json`, DEMO_DIR));
  const fail = (msg: string): false => {
    console.error(`✗ ${name}: ${msg}`);
    return false;
  };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(projectPath, 'utf8')) as unknown;
  } catch (e) {
    return fail(`cannot read ${projectPath}: ${describeError(e)}`);
  }
  const parsed = studioProjectSchema.safeParse(raw);
  if (!parsed.success) return fail(`not a valid studio project: ${parsed.error.message}`);
  // Build from the file's own object (not the zod output) so the deterministic IV stream matches demo.test.ts.
  const project = raw as StudioProject;
  if (project.kdfSalt === undefined) return fail('kdfSalt must be fixed in the project file');
  if (hasStoreCode(project)) return fail('demo projects must not contain store codes');

  const issues = lintProject(project);
  for (const i of issues) console.log(`  ${i.severity === 'error' ? 'error' : 'warn '} ${i.path}: ${i.messageJa}`);
  if (issues.some((i) => i.severity === 'error')) return fail('lint errors');

  let result: Awaited<ReturnType<typeof buildDemo>>;
  try {
    result = await buildDemo(project);
  } catch (e) {
    return fail(`build failed: ${describeError(e)}`);
  }
  for (const c of result.report.checks) {
    if (!c.ok) console.error(`  NG ${c.id}: ${c.messageJa}`);
  }
  if (!result.report.ok) return fail('self-test failed; nothing written');
  if (hasStoreCode(result.build.manifest)) return fail('built manifest contains a store code');

  let previous: string | undefined;
  try {
    previous = readFileSync(outPath, 'utf8');
  } catch {
    previous = undefined;
  }
  if (previous === result.text) {
    console.log(`✓ ${name}: ${outPath} is up to date (${result.report.checks.length} checks passed)`);
  } else {
    writeFileSync(outPath, result.text, 'utf8');
    console.log(`✓ ${name}: wrote ${outPath} (${result.report.checks.length} checks passed)`);
  }
  return true;
}

async function main(): Promise<void> {
  let ok = true;
  for (const name of DEMO_NAMES) {
    if (!(await buildOne(name))) ok = false;
  }
  if (!ok) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
