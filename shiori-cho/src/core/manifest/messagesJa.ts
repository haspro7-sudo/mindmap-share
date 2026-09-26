// STUB (contract) — map zod issues / custom issue codes to Japanese messages.
import type { ValidationIssue } from '../types';

/** Formats a path array like ['goals', 3, 'hints', 1] → 'goals[3].hints[1]' */
export declare function formatPath(path: ReadonlyArray<PropertyKey>): string;
/** Converts a zod error's issues into ValidationIssue[] with Japanese messages. */
export declare function zodIssuesToValidationIssues(issues: ReadonlyArray<unknown>): ValidationIssue[];
/** Japanese message for a custom issue code (e.g. 'duplicateId', 'danglingGroup'). */
export declare function customMessageJa(code: string, params?: Record<string, string | number>): string;
