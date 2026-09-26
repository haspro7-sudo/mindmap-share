/**
 * `||…||` spoiler spans in notes (docs/SPEC.md F14 AC2). Rendering stays plain text.
 */
export interface TextSpan {
  text: string;
  spoiler: boolean;
}

const MARK = '||';

/**
 * Splits text into plain and spoiler spans. An unclosed '||' is literal text. Adjacent plain spans are merged.
 * '||' opens a spoiler and the next '||' closes it; an empty spoiler ('||||') produces no span.
 * Empty spans are never returned, so '' → [].
 */
export function parseSpoilerSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const pushPlain = (s: string): void => {
    if (s === '') return;
    const last = spans[spans.length - 1];
    if (last && !last.spoiler) last.text += s;
    else spans.push({ text: s, spoiler: false });
  };

  let i = 0;
  while (i < text.length) {
    const open = text.indexOf(MARK, i);
    if (open < 0) break;
    const close = text.indexOf(MARK, open + MARK.length);
    if (close < 0) break; // unclosed: the '||' and everything after it stay literal
    pushPlain(text.slice(i, open));
    const inner = text.slice(open + MARK.length, close);
    if (inner !== '') spans.push({ text: inner, spoiler: true });
    i = close + MARK.length;
  }
  pushPlain(text.slice(i));
  return spans;
}
