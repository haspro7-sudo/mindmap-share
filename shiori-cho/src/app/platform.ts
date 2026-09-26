// STUB (contract) — thin browser wrappers (all feature-detected, never throw).
export declare function vibrate(ms: number): void;
export declare function readClipboard(): Promise<string | null>;
export declare function writeClipboard(text: string): Promise<boolean>;
export declare function requestPersist(): Promise<boolean>;
export declare function isIosSafariNotStandalone(): boolean;
export declare function isCoarsePointer(): boolean;
export declare function prefersReducedMotion(): boolean;
export declare function download(filename: string, data: Blob | string, mime?: string): void;
export declare function readFileAsText(file: File): Promise<string>;
