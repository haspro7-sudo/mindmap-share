// STUB (contract) — docs/SPEC.md F4 AC1, §7.3.
export interface StoreCode {
  prefix: 'RJ' | 'VJ' | 'BJ';
  digits: string;
  /** normalized, e.g. 'RJ01667536' */
  code: string;
}
/** NFKC + trim + upper; RJ/VJ/BJ + 6 or 8 digits; else null */
export declare function parseStoreCode(input: string): StoreCode | null;
/** RJ→maniax, VJ→pro, BJ→books; touch → '<floor>-touch'. https://www.dlsite.com/<floor>/work/=/product_id/<code>.html */
export declare function buildStoreUrl(code: string | StoreCode, opts: { touch: boolean }): string;
