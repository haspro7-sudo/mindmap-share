// STUB (contract) — hash routes (docs/SPEC.md §6). Hash contains only local UUIDs, numeric indices, or deep-link segments.
export type WorkTab = 'progress' | 'extras' | 'log' | 'notes';
export type StudioTab = 'work' | 'structure' | 'goals' | 'extras' | 'check' | 'export';
export type HelpSection = 'usage' | 'demo-codes' | 'ios' | 'creators' | 'privacy' | 'about';

export type Route =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'work'; id: string; tab: WorkTab; sheet?: { type: 'goal' | 'sealed'; index: number } }
  | { name: 'workEdit'; id: string }
  | { name: 'code'; workId?: string }
  | { name: 'unlock'; manifestWorkId: string; code: string }
  | { name: 'settings' }
  | { name: 'studio' }
  | { name: 'studioProject'; id: string; tab: StudioTab }
  | { name: 'studioPreview'; id: string }
  | { name: 'demoPc' }
  | { name: 'help'; section?: HelpSection }
  | { name: 'notFound' };

/**
 * '#/', '', '#' → home; '#/add'; '#/w/<id>?tab=progress&sheet=g3'; '#/w/<id>/edit'; '#/code?w=<id>';
 * '#/u/<manifestWorkId>/<code>' (code percent-decoded); '#/settings'; '#/studio'; '#/studio/<pid>?tab=goals';
 * '#/studio/<pid>/preview'; '#/demo-pc'; '#/help' / '#/help/<section>'; anything else → notFound.
 * Default tabs: work → 'progress', studioProject → 'work'. Unknown tab values fall back to the default.
 */
export declare function parseHashRoute(hash: string): Route;
/** Inverse of parseHashRoute (omits default tab). Always starts with '#/'. */
export declare function buildHash(route: Route): string;
/** `${appUrl without trailing '#…'}#/u/${workId}/${encodeURIComponent(canonical without 'b32:'/'kana:' prefix)}` */
export declare function buildUnlockUrl(appUrl: string, manifestWorkId: string, canonical: string): string;
/** Finds '#/u/<workId>/<code>' inside arbitrary text (e.g. a pasted URL inside prose). */
export declare function extractUnlockFromText(text: string): { manifestWorkId: string; code: string } | null;
