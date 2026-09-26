// STUB (contract) — StudioProject → sealed shiori.json. See docs/SPEC.md §4.3, §4.4.
import type { BuildResult, StudioProject } from '../types';
import type { Rng } from '../encoding';

/**
 * Builds the public manifest. Uses project.kdfSalt if set (else generates 16 random bytes → returned as `salt`).
 * Throws ShioriError('validation') if the project is not buildable (e.g. code goal without a valid code).
 */
export declare function buildManifest(project: StudioProject, opts?: { rng?: Rng }): Promise<BuildResult>;
