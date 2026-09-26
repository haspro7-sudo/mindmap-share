// STUB (UI contract) — F3: PIN pad, 5 failures → 30 s cooldown (persisted), 「PINを忘れた」 → wipe flow.
import type { ReactNode } from 'react';
export declare function LockScreen(props: { onUnlock(): void; onWipe(): void }): ReactNode;
