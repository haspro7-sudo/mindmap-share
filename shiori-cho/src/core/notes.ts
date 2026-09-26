// STUB (contract) — `||…||` spoiler spans (docs/SPEC.md F14 AC2).
export interface TextSpan {
  text: string;
  spoiler: boolean;
}
/** Splits text into plain and spoiler spans. An unclosed '||' is literal text. Adjacent plain spans are merged. */
export declare function parseSpoilerSpans(text: string): TextSpan[];
