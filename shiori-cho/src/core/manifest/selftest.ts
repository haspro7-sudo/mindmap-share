// STUB (contract) — validates the built manifest, redeems every code, opens every sealed item.
import type { CodeRow, SelfTestReport, ShioriManifestV1, StudioProject } from '../types';

export declare function selfTest(manifest: ShioriManifestV1, codes: readonly CodeRow[], project: StudioProject): Promise<SelfTestReport>;
