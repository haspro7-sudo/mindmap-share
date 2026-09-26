// STUB (contract) — text files of the creator kit (docs/SPEC.md §4.4). QR PNGs are added by app/studio.ts.
import type { CodeRow, KitFile, StudioProject } from './types';

/**
 * Returns exactly these paths (all string content):
 *  同梱用_PUBLIC/shiori.json, 同梱用_PUBLIC/はじめに.txt, 非公開_ゲームに埋め込む/codes.csv,
 *  非公開_ゲームに埋め込む/エンジン別の表示例.txt, 非公開_控え/project.shiori-studio.json,
 *  告知文テンプレート.txt, README_最初に読んでください.txt
 */
export declare function buildKitTextFiles(args: { project: StudioProject; json: string; codes: readonly CodeRow[]; appUrl: string }): KitFile[];
/** RFC 4180 CSV escaping for one row */
export declare function csvRow(cells: readonly string[]): string;
/** 「【クリア特典】作中の“合言葉”を…」 store-description template */
export declare function storeTemplateJa(project: StudioProject): string;
