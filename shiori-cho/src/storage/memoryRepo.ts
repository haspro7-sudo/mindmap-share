// STUB (contract) — in-memory ShioriRepo/StudioRepo (used in tests and the studio preview). Deep-copies on read/write.
import type { BackupDataV1, Settings } from '../core/types';
import type { ShioriRepo, StudioRepo } from './repo';

export declare function createMemoryRepo(seed?: Partial<BackupDataV1> & { fullSettings?: Partial<Settings> }): ShioriRepo;
export declare function createMemoryStudioRepo(): StudioRepo;
