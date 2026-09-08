import { describe, expect, it } from 'vitest';

import { findPage, fromNotion, infer, looksLikeNotion, type NotionPage } from './notion';

const CSV = `Name,Status,Owner,Estimate,Due,Done,Link,Tags,Notes,Empty
Draft the brief,In progress,Ana,3,2026-09-15,Yes,https://example.com/brief,"design, urgent",Something to say,
Review the brief,To do,Bruno,1.5,2026-09-18,No,https://example.com/review,design,,
Ship it,To do,Ana,8,2026-09-25,No,https://example.com/ship,"urgent",,
Write the notes,Done,Bruno,2,2026-09-10,Yes,https://example.com/notes,design,,
`;

const PAGES: NotionPage[] = [
  {
    name: 'Draft the brief a1b2c3',
    text: '# Draft the brief\n\nThree directions, one afternoon.\n\n## Directions\n\n- [x] Bold and dark\n- [ ] Light and airy\n',
  },
  { name: 'Ship it d4e5f6', text: '# Ship it\n\nAfter the review.\n' },
];

describe('recognising a Notion export', () => {
  it('takes a table with a title column and rows', () => {
    expect(looksLikeNotion(CSV)).toBe(true);
    expect(looksLikeNotion('Name\nOnly one column\n')).toBe(false);
    expect(looksLikeNotion('Name,Status\n')).toBe(false); // a header alone
    expect(looksLikeNotion('')).toBe(false);
  });
});

describe('inferring what a column is', () => {
  it('reads a checkbox, a number, a date, an instant and a link', () => {
    expect(infer(['Yes', 'No', 'yes']).type).toBe('checkbox');
    expect(infer(['1', '2.5', '-3']).type).toBe('number');
    expect(infer(['2026-09-15', '2026-01-01']).type).toBe('date');
    expect(infer(['2026-09-15T10:00:00Z', '2026-01-01 09:00']).type).toBe('datetime');
    expect(infer(['https://a.example', 'http://b.example/x']).type).toBe('url');
  });

  it('reads repeated short values as choices, and commas as several of them', () => {
    const select = infer(['To do', 'Done', 'To do', 'Done']);
    expect(select.type).toBe('select');
    expect(select.options!.map((option) => option.label)).toEqual(['To do', 'Done']);

    const multi = infer(['design, urgent', 'design', 'urgent', 'design']);
    expect(multi.type).toBe('multi_select');
    expect(multi.options!.map((option) => option.label)).toEqual(['design', 'urgent']);
  });

  it('is timid: text whenever the values disagree, or there is too little to go on', () => {
    // One value that is not a number makes the column text.
    expect(infer(['1', '2', 'about three', '4']).type).toBe('text');
    // Four distinct values in four rows repeat nothing: prose, not choices.
    expect(infer(['Ana', 'Bruno', 'Carla', 'Dora']).type).toBe('text');
    // Two rows is not enough repetition to mean anything.
    expect(infer(['To do', 'To do']).type).toBe('text');
    // Long values are prose even when they repeat.
    expect(infer([`${'x'.repeat(50)}`, `${'x'.repeat(50)}`, 'y', 'y']).type).toBe('text');
  });

  it('says what a column nearly was, and skips one with nothing in it', () => {
    expect(infer(['1', '2', '3', '4', 'n/a']).wanted).toBe('number');
    expect(infer(['', '  ', ''])).toEqual({ type: 'skip' });
  });
});

describe('a Notion database', () => {
  const plan = fromNotion(CSV, 'Work', PAGES)!;
  const byTitle = new Map(plan.tasks.map((task) => [task.title, task]));

  it('is a collection named after the database, one task per row', () => {
    expect(plan.collections).toEqual([{ name: 'Work', icon: null, color: null }]);
    expect(plan.tasks.map((task) => task.title)).toEqual([
      'Draft the brief',
      'Review the brief',
      'Ship it',
      'Write the notes',
    ]);
    expect(plan.source).toBe('a Notion database (Work)');
  });

  it('keeps each column’s type where the values agree', () => {
    const types = new Map(plan.properties!.map((property) => [property.name, property.type]));
    expect(types.get('Status')).toBe('select');
    expect(types.get('Estimate')).toBe('number');
    expect(types.get('Due')).toBe('date');
    expect(types.get('Done')).toBe('checkbox');
    expect(types.get('Link')).toBe('url');
    expect(types.get('Tags')).toBe('multi_select');
    // Owner has four rows and two names, each twice: choices.
    expect(types.get('Owner')).toBe('select');
    // Notes says something once: prose.
    expect(types.get('Notes')).toBe('text');
    // An empty column is not a property at all.
    expect(types.has('Empty')).toBe(false);
  });

  it('stores each value as its type wants it', () => {
    const draft = byTitle.get('Draft the brief')!;
    expect(draft.values.Estimate).toBe(3);
    expect(draft.values.Due).toBe('2026-09-15');
    expect(draft.values.Done).toBe(true);
    expect(draft.values.Link).toBe('https://example.com/brief');
    expect(draft.values.Tags).toEqual(['design', 'urgent']);
    expect(byTitle.get('Review the brief')!.values.Done).toBe(false);
    // A select stores the option's id, which is the label made into a slug.
    const status = plan.properties!.find((property) => property.name === 'Status')!;
    expect(status.options!.map((option) => option.id)).toContain('in-progress');
    expect(draft.values.Status).toBe('in-progress');
    // An empty cell stores nothing rather than an empty string.
    expect(byTitle.get('Ship it')!.values.Notes).toBeUndefined();
  });

  it('gives a row its page as the document, and the first paragraph as the note', () => {
    const draft = byTitle.get('Draft the brief')!;
    expect(draft.blocks!.map((block) => block.type)).toEqual(['paragraph', 'heading', 'taskList']);
    expect(draft.notes).toBe('Three directions, one afternoon.');
    // A row with no page file has no document and no note.
    expect(byTitle.get('Review the brief')!.blocks).toEqual([]);
    expect(byTitle.get('Review the brief')!.notes).toBeNull();
  });

  it('says what it inferred, what it skipped and what Notion keeps to itself', () => {
    expect(plan.warnings).toEqual([
      '1 empty column was left out: “Empty”.',
      '2 of 4 rows have a page, imported as its document.',
      '2 rows had no page file beside the table.',
      'Notion’s relations, formulas, rollups and files are not carried: a database is imported as its own rows.',
    ]);
  });

  it('refuses what is not a table, and names an untitled row', () => {
    expect(fromNotion('Name\nonly\n', 'x')).toBeNull();
    expect(fromNotion('', 'x')).toBeNull();
    const untitled = fromNotion('Name,Other\n,value\n', 'x')!;
    expect(untitled.tasks[0]!.title).toBe('Untitled');
    expect(fromNotion(CSV, '   ')!.collections[0]!.name).toBe('Notion');
  });
});

describe('finding a row’s page', () => {
  const pages = new Map(PAGES.map((page) => [page.name, page]));

  it('matches the file Notion named after the title and its hash', () => {
    expect(findPage(pages, 'Draft the brief')?.name).toBe('Draft the brief a1b2c3');
    expect(findPage(pages, 'Review the brief')).toBeUndefined();
    expect(findPage(pages, '')).toBeUndefined();
    // A title that is a prefix of another does not steal its page.
    expect(findPage(pages, 'Draft')).toBeUndefined();
  });
});
