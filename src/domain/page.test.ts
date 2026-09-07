import { describe, expect, it } from 'vitest';

import type { DocJSON } from './document';
import {
  checkTitle,
  exactly,
  labelOf,
  linksIn,
  refresh,
  resolve,
  suggest,
  targetsOf,
  titleKey,
  type Page,
} from './page';

const page = (id: string, title: string, updatedAt = '2026-09-01T10:00:00.000Z'): Page => ({
  id,
  title,
  updatedAt,
});

const PAGES: Page[] = [
  page('p1', 'Weekly Review', '2026-09-05T10:00:00.000Z'),
  page('p2', 'Onboarding', '2026-09-04T10:00:00.000Z'),
  page('p3', "Last Week's Notes", '2026-09-06T10:00:00.000Z'),
];

const link = (pageId: string | null, title: string) => ({
  type: 'pageLink',
  attrs: { pageId, title },
});

const document = (...content: DocJSON['content']): DocJSON => ({ type: 'doc', content });

const paragraph = (...content: unknown[]): DocJSON['content'][number] => ({
  type: 'paragraph',
  content: content as DocJSON['content'],
});

describe('the same name, written two ways', () => {
  it('is the same page', () => {
    expect(titleKey('  Weekly   Review ')).toBe(titleKey('weekly review'));
    expect(titleKey('Onboarding')).not.toBe(titleKey('On boarding'));
    expect(titleKey('   ')).toBe('');
  });
});

describe('what a page may be called', () => {
  it('accepts a name that is not taken', () => {
    expect(checkTitle('Retrospective', PAGES)).toBeNull();
  });

  it('refuses a name that is only space, or too long', () => {
    expect(checkTitle('   ', PAGES)).toBe('A page needs a name.');
    expect(checkTitle('x'.repeat(201), PAGES)).toContain('at most 200');
  });

  it('refuses a bracket, because a bracket ends a link', () => {
    expect(checkTitle('Notes [2026]', PAGES)).toBe('A name cannot contain square brackets.');
  });

  it('refuses a name another page already has, however it is typed', () => {
    expect(checkTitle('weekly   review', PAGES)).toBe('There is already a page with that name.');
    // The page being renamed is not in `existing`, so keeping its own name is fine.
    expect(
      checkTitle(
        'Weekly Review',
        PAGES.filter((entry) => entry.id !== 'p1'),
      ),
    ).toBeNull();
  });
});

describe('what a link points at', () => {
  it('follows the id first, whatever name was written beside it', () => {
    expect(resolve({ pageId: 'p1', title: 'Something else entirely' }, PAGES)).toBe(PAGES[0]);
  });

  it('falls back to the name when the id is gone — a page deleted and made again', () => {
    expect(resolve({ pageId: 'deleted', title: 'onboarding' }, PAGES)).toBe(PAGES[1]);
  });

  it('resolves nothing for a name no page has, and keeps the words that were written', () => {
    const dangling = { pageId: null, title: 'Retrospective' };
    expect(resolve(dangling, PAGES)).toBeUndefined();
    expect(labelOf(dangling, PAGES)).toBe('Retrospective');
  });

  it('reads as the target’s current name, not the one in the document', () => {
    expect(labelOf({ pageId: 'p1', title: 'The Old Name' }, PAGES)).toBe('Weekly Review');
  });
});

describe('reading a document', () => {
  const doc = document(
    paragraph({ type: 'text', text: 'See ' }, link('p1', 'Weekly Review'), {
      type: 'text',
      text: ' and ',
    }),
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [paragraph(link(null, 'Retrospective'), link('p1', 'Weekly Review'))],
        },
      ],
    },
  );

  it('finds every link, however deep, in the order they are written', () => {
    expect(linksIn(doc)).toEqual([
      { pageId: 'p1', title: 'Weekly Review' },
      { pageId: null, title: 'Retrospective' },
      { pageId: 'p1', title: 'Weekly Review' },
    ]);
  });

  it('ignores a link that names nothing and points nowhere', () => {
    expect(linksIn(document(paragraph(link(null, '   '))))).toEqual([]);
  });

  it('reads an empty document without complaining', () => {
    expect(linksIn(document())).toEqual([]);
    expect(linksIn(document({ type: 'paragraph' }))).toEqual([]);
  });

  it('folds the targets a document points at, keeping the dangling one', () => {
    expect(targetsOf(doc, PAGES)).toEqual([
      { pageId: 'p1', title: 'Weekly Review' },
      { pageId: null, title: 'Retrospective' },
    ]);
  });

  it('binds a name-only link to the page that now has that name', () => {
    const named = document(paragraph(link(null, 'onboarding')));
    expect(targetsOf(named, PAGES)).toEqual([{ pageId: 'p2', title: 'Onboarding' }]);
  });
});

describe('a rename, seen from the documents that point at the renamed page', () => {
  const doc = document(paragraph({ type: 'text', text: 'Prepare ' }, link('p1', 'Weekly Review')), {
    type: 'callout',
    attrs: { tone: 'info' },
    content: [paragraph(link('p2', 'Onboarding'))],
  });

  it('brings every name up to date, at any depth', () => {
    const renamed = [page('p1', 'Monday Review', '2026-09-07T10:00:00.000Z'), PAGES[1]!, PAGES[2]!];
    const next = refresh(doc, renamed);

    expect(linksIn(next)).toEqual([
      { pageId: 'p1', title: 'Monday Review' },
      { pageId: 'p2', title: 'Onboarding' },
    ]);
    // The link did not move: it is the same id it always was.
    expect(linksIn(next).map((entry) => entry.pageId)).toEqual(['p1', 'p2']);
  });

  it('gives back the same document when there is nothing to bring up to date', () => {
    expect(refresh(doc, PAGES)).toBe(doc);
  });

  it('binds a link written by name alone once the page exists', () => {
    const named = document(paragraph(link(null, 'retrospective')));
    const withPage = [...PAGES, page('p4', 'Retrospective')];
    expect(linksIn(refresh(named, withPage))).toEqual([{ pageId: 'p4', title: 'Retrospective' }]);
  });

  it('leaves a link to a page that is gone exactly as it was written', () => {
    const orphan = document(paragraph(link('deleted', 'Archived Plan')));
    expect(refresh(orphan, PAGES)).toBe(orphan);
    expect(linksIn(orphan)).toEqual([{ pageId: 'deleted', title: 'Archived Plan' }]);
  });
});

describe('choosing a page after typing two brackets', () => {
  it('puts what starts with the query before what merely contains it', () => {
    expect(suggest('week', PAGES).map((entry) => entry.title)).toEqual([
      'Weekly Review',
      "Last Week's Notes",
    ]);
  });

  it('offers the most recently touched first when nothing has been typed', () => {
    expect(suggest('', PAGES).map((entry) => entry.title)).toEqual([
      "Last Week's Notes",
      'Weekly Review',
      'Onboarding',
    ]);
  });

  it('ignores case and spacing, and stops at the limit', () => {
    expect(suggest('  WEEKLY  ', PAGES).map((entry) => entry.id)).toEqual(['p1']);
    expect(suggest('', PAGES, 2)).toHaveLength(2);
  });

  it('says when a name is already exactly a page, so nothing offers to make a second', () => {
    expect(exactly('weekly review', PAGES)?.id).toBe('p1');
    expect(exactly('Weekly', PAGES)).toBeUndefined();
    expect(exactly('  ', PAGES)).toBeUndefined();
  });
});
