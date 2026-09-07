/**
 * Pages — the notes space, and the links between them.
 *
 * A page is a title and a document. What makes it a *wiki* is one thing: a
 * page can point at another one, by writing its name, and the product knows
 * they are connected — from both ends.
 *
 * # The decision the rest follows from
 *
 * A link **points at an identity and shows a name** (ADR-029). The link a
 * document stores is the target's id; the words on screen are the target's
 * title, kept beside the id and refreshed when the document is opened. So
 * renaming a page keeps every link to it — nothing is rewritten, because
 * nothing pointed at the name in the first place — and the new name is what
 * the next reader sees.
 *
 * A link whose target no longer exists is not deleted. It keeps the name it
 * was written with and resolves again the day a page of that name comes back,
 * which is what a wiki is expected to do and what a foreign key would forbid.
 *
 * Pure: no I/O, no React, no host.
 */

import type { DocJSON, DocNode } from './document';

/** The node type an inline link is stored as. */
export const PAGE_LINK = 'pageLink';

/** A page, as the interface handles it. */
export interface Page {
  id: string;
  title: string;
  updatedAt: string;
}

/** A link as it appears in a document: an identity, and the name it showed. */
export interface Link {
  /** The page it points at; null when it was written for a page that is gone. */
  pageId: string | null;
  /** The name written in the document — the fallback, and what a name-link uses. */
  title: string;
}

/** Where a link was written, for the backlink panel. */
export interface Backlink {
  ownerKind: 'page' | 'item' | 'event';
  ownerId: string;
  title: string;
  /** The sentence the link sits in, for context. Empty when there is none. */
  excerpt: string;
}

/** The longest a title may be. Longer is a paragraph, not a name. */
export const MAX_TITLE = 200;

/** What a page is called before it is called anything. */
export const UNTITLED = 'Untitled';

/**
 * A title reduced to what makes two titles the same one.
 *
 * `  Weekly   Review ` and `weekly review` are the same page. Case and spacing
 * are how people actually type a name in the middle of a sentence, and a wiki
 * that treated them as different pages would quietly grow three of everything.
 */
export function titleKey(title: string): string {
  return title.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

/**
 * What is wrong with this title, in a sentence, or null when nothing is.
 *
 * `existing` is every other page — the one being renamed is not in it, so a
 * page keeps its own name without being told it is taken.
 */
export function checkTitle(title: string, existing: readonly Page[]): string | null {
  const trimmed = title.trim();
  if (trimmed === '') return 'A page needs a name.';
  if (trimmed.length > MAX_TITLE) return `A name can be at most ${MAX_TITLE} characters.`;
  // A name is written inside a sentence, between brackets: a bracket in the
  // name would end the link early and point at something else.
  if (/[[\]]/.test(trimmed)) return 'A name cannot contain square brackets.';
  const key = titleKey(trimmed);
  return existing.some((page) => titleKey(page.title) === key)
    ? 'There is already a page with that name.'
    : null;
}

/** The page a link resolves to: by id, and failing that by name. */
export function resolve(link: Link, pages: readonly Page[]): Page | undefined {
  if (link.pageId !== null) {
    const byId = pages.find((page) => page.id === link.pageId);
    if (byId !== undefined) return byId;
  }
  const key = titleKey(link.title);
  return key === '' ? undefined : pages.find((page) => titleKey(page.title) === key);
}

/** What a link should read as: the target's name, or the name it was written with. */
export function labelOf(link: Link, pages: readonly Page[]): string {
  return resolve(link, pages)?.title ?? link.title;
}

// ── Reading a document ─────────────────────────────────────────────────────

/**
 * Every link in a document, in the order they are written.
 *
 * Duplicates are kept: a page that mentions another three times says something
 * a page that mentions it once does not, and the caller decides whether to
 * fold them.
 */
export function linksIn(document: DocJSON | DocNode): Link[] {
  const found: Link[] = [];
  walk(document as DocNode, (node) => {
    if (node.type !== PAGE_LINK) return;
    const attrs = node.attrs ?? {};
    const pageId = typeof attrs.pageId === 'string' && attrs.pageId !== '' ? attrs.pageId : null;
    const title = typeof attrs.title === 'string' ? attrs.title : '';
    if (pageId === null && titleKey(title) === '') return;
    found.push({ pageId, title });
  });
  return found;
}

/** The distinct targets a document points at — what the host stores as its links. */
export function targetsOf(document: DocJSON, pages: readonly Page[]): Link[] {
  const seen = new Set<string>();
  const targets: Link[] = [];
  for (const link of linksIn(document)) {
    const page = resolve(link, pages);
    const target: Link = page === undefined ? link : { pageId: page.id, title: page.title };
    const key = target.pageId ?? `name:${titleKey(target.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

/**
 * The document with every link's name brought up to date.
 *
 * This is where a rename becomes visible. The link never moved — it points at
 * an id — but the words beside it were written when the page had another name,
 * so they are refreshed as the document is opened. A document with nothing to
 * refresh is returned as it was, so an editor is not handed a new object for
 * no reason.
 */
export function refresh(document: DocJSON, pages: readonly Page[]): DocJSON {
  let changed = false;

  const rewrite = (node: DocNode): DocNode => {
    const content = node.content?.map(rewrite);
    const inside =
      content !== undefined && content.some((child, at) => child !== node.content?.[at]);

    if (node.type === PAGE_LINK) {
      const attrs = node.attrs ?? {};
      const written: Link = {
        pageId: typeof attrs.pageId === 'string' && attrs.pageId !== '' ? attrs.pageId : null,
        title: typeof attrs.title === 'string' ? attrs.title : '',
      };
      const page = resolve(written, pages);
      if (page !== undefined && (page.title !== written.title || page.id !== written.pageId)) {
        changed = true;
        return {
          ...node,
          ...(inside ? { content } : {}),
          attrs: { ...attrs, pageId: page.id, title: page.title },
        };
      }
    }

    if (!inside) return node;
    changed = true;
    return { ...node, content };
  };

  const content = document.content.map(rewrite);
  return changed ? { ...document, content } : document;
}

// ── Choosing one ───────────────────────────────────────────────────────────

/**
 * The pages to offer for what has been typed after `[[`.
 *
 * A name that starts with the query comes before one that merely contains it,
 * because a person typing "we" means Weekly Review before Last Week's Notes.
 * Beyond that the more recently touched page wins: in a notes space, what you
 * are writing about is what you were writing about.
 */
export function suggest(query: string, pages: readonly Page[], limit = 8): Page[] {
  const key = titleKey(query);
  const scored = pages
    .map((page) => {
      const candidate = titleKey(page.title);
      if (key === '') return { page, rank: 1 };
      if (candidate.startsWith(key)) return { page, rank: 0 };
      return candidate.includes(key) ? { page, rank: 1 } : null;
    })
    .filter((entry): entry is { page: Page; rank: number } => entry !== null);

  scored.sort((a, b) => a.rank - b.rank || (a.page.updatedAt < b.page.updatedAt ? 1 : -1));
  return scored.slice(0, limit).map((entry) => entry.page);
}

/** Is there already a page with exactly this name? */
export function exactly(query: string, pages: readonly Page[]): Page | undefined {
  const key = titleKey(query);
  return key === '' ? undefined : pages.find((page) => titleKey(page.title) === key);
}

// ── Walking ────────────────────────────────────────────────────────────────

function walk(node: DocNode, visit: (node: DocNode) => void): void {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}
