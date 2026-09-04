/**
 * Search: the shape of a query the full-text index will accept, and the shape
 * of a hit the interface can render.
 *
 * FTS5 has a query language — `AND`, `OR`, `NOT`, `NEAR`, column filters,
 * quoted phrases. A person typing into a search box is not writing in it, and
 * a bare `"` or a stray `(` would turn their words into a syntax error. So
 * every token is quoted before it reaches the index, and the last one becomes
 * a prefix so results appear while a word is still being typed.
 */

/** The delimiters the index wraps a hit in. Control characters: never typed. */
export const HIT_OPEN = '';
export const HIT_CLOSE = '';

/**
 * A raw search string, as a safe FTS5 query — or null when there is nothing
 * worth asking.
 *
 * Tokens are split on whitespace; anything without a letter or digit is
 * dropped (punctuation alone matches nothing and can only break the parse).
 * Double quotes inside a token are doubled, which is how FTS5 escapes them.
 */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.replace(/^["'()*:^-]+|["'()*:^-]+$/g, ''))
    .filter((token) => /[\p{L}\p{N}]/u.test(token));

  if (tokens.length === 0) return null;

  return tokens
    .map((token, index) => {
      const quoted = `"${token.replace(/"/g, '""')}"`;
      return index === tokens.length - 1 ? `${quoted}*` : quoted;
    })
    .join(' ');
}

export interface SnippetSegment {
  text: string;
  hit: boolean;
}

/**
 * Split a snippet from the index into plain and highlighted runs.
 *
 * The index marks hits with control characters; this turns them into data the
 * interface renders as elements. No markup travels through, so nothing is ever
 * injected into the page — a title that contains `<b>` stays the text `<b>`.
 */
export function splitSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let hit = false;
  let buffer = '';

  for (const char of snippet) {
    if (char === HIT_OPEN || char === HIT_CLOSE) {
      if (buffer.length > 0) segments.push({ text: buffer, hit });
      buffer = '';
      hit = char === HIT_OPEN;
      continue;
    }
    buffer += char;
  }
  if (buffer.length > 0) segments.push({ text: buffer, hit });
  return segments;
}

export type SearchOwner = 'item' | 'event';

export interface SearchHit {
  ownerKind: SearchOwner;
  ownerId: string;
  /** The title with hits marked — feed it to `splitSnippet`. */
  title: string;
  /** A window of the body around the first hit, marked the same way. */
  body: string;
  completed: boolean;
}
