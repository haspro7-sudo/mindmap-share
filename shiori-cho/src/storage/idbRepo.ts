// STUB (contract) — IndexedDB ShioriRepo using `idb` (DB 'shiori', version 1; layout in docs/SPEC.md §5.3).
import type { ShioriRepo } from './repo';

export declare function openIdbRepo(dbName?: string): Promise<ShioriRepo>;
/** Deletes the whole database (used by 全データを消す). */
export declare function deleteIdbDatabase(dbName?: string): Promise<void>;
