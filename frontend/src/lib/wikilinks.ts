/** Obsidian-style `[[Target]]` / `[[Target|label]]` links (same rules as app/wikilinks.py). */

const WIKILINK = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]*))?\]\]/g;

export interface WikilinkMatch {
  /** Whole link, "[[" to "]]". */
  from: number;
  to: number;
  /** The raw target text (between "[[" and "|" or "]]"). */
  targetFrom: number;
  targetTo: number;
  /** The label after "|", when there is one. */
  labelFrom: number | null;
  target: string;
  label: string | null;
}

/** "  Payroll   ideas " -> "Payroll ideas" (how the server compares targets). */
export function normalizeTarget(target: string): string {
  return target.split(/\s+/).filter(Boolean).join(' ');
}

export function targetKey(target: string): string {
  return normalizeTarget(target).toLowerCase();
}

/** Links in one piece of text; positions are offset by `offset`. */
export function matchWikilinks(text: string, offset = 0): WikilinkMatch[] {
  const out: WikilinkMatch[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    const target = normalizeTarget(m[1] ?? '');
    if (!target) continue;
    const from = offset + (m.index ?? 0);
    const targetFrom = from + 2;
    const targetTo = targetFrom + (m[1] ?? '').length;
    const label = m[2] === undefined ? null : m[2].trim();
    out.push({
      from,
      to: from + m[0].length,
      targetFrom,
      targetTo,
      labelFrom: label === null ? null : targetTo + 1,
      target,
      label,
    });
  }
  return out;
}

/** The text typed after an unclosed "[[" right before the cursor, or null. */
export function openLinkQuery(textBeforeCursor: string): string | null {
  const m = /\[\[([^[\]\n|]*)$/.exec(textBeforeCursor);
  return m ? (m[1] ?? '') : null;
}

/** Note titles cannot contain characters that would break a link (same rule as the server). */
export const TITLE_FORBIDDEN = /[[\]|\n\r]/;
