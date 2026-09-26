// STUB (contract) — zod 4 schemas for shiori/1 manifest + studio project. See docs/SPEC.md §4.1–4.2, §5.1.
import type { z } from 'zod';

/** Structural schema for ShioriManifestV1 (cross-reference checks live in validate.ts). */
export declare const manifestSchema: z.ZodType;
/** Schema for StudioProject files ('shiori-studio-project', version 1). */
export declare const studioProjectSchema: z.ZodType;
