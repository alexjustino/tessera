import { describe, expect, it } from 'vitest';

import type { Item } from './item';
import type { Property } from './property';
import {
  accepts,
  EMPTY_QUERY,
  isRelative,
  resolveRelative,
  fieldKey,
  flatten,
  operatorsFor,
  run,
  sameField,
  type FieldRef,
  type Filter,
  type Query,
  type Row,
} from './query';

// ── Fixtures ───────────────────────────────────────────────────────────────

const STATUS: Property = {
  id: 'p-status',
  collectionId: 'tasks',
  key: 'status',
  name: 'Status',
  type: 'status',
  config: {
    options: [
      { id: 'todo', label: 'To do', color: null, group: 'todo' },
      { id: 'doing', label: 'In progress', color: 'info', group: 'doing' },
      { id: 'done', label: 'Done', color: 'success', group: 'done' },
    ],
  },
  position: 'V',
  isSystem: true,
};

const PRIORITY: Property = {
  id: 'p-priority',
  collectionId: 'tasks',
  key: 'priority',
  name: 'Priority',
  type: 'priority',
  config: {},
  position: 'a',
  isSystem: true,
};

const ESTIMATE: Property = {
  id: 'p-estimate',
  collectionId: 'tasks',
  key: 'estimate',
  name: 'Estimate',
  type: 'duration',
  config: {},
  position: 'b',
  isSystem: false,
};

const TAGS: Property = {
  id: 'p-tags',
  collectionId: 'tasks',
  key: 'tags',
  name: 'Tags',
  type: 'multi_select',
  config: {
    options: [
      { id: 'home', label: 'Home', color: null },
      { id: 'work', label: 'Work', color: null },
    ],
  },
  position: 'c',
  isSystem: false,
};

const PROPERTIES = [STATUS, PRIORITY, ESTIMATE, TAGS];

let clock = 0;
function row(
  id: string,
  title: string,
  position: string,
  values: Record<string, unknown> = {},
  completed = false,
): Row {
  clock += 1;
  const stamp = `2026-09-0${Math.min(9, clock)}T10:00:00.000Z`;
  const item: Item = {
    id,
    collectionId: 'tasks',
    parentItemId: null,
    title,
    position,
    startAt: null,
    dueAt: null,
    remindAt: null,
    recurrenceRule: null,
    recurrenceMode: 'schedule',
    completedAt: completed ? '2026-09-09T10:00:00.000Z' : null,
    estimateMinutes: null,
    isMilestone: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
  return { item, values };
}

const ROWS: Row[] = [
  row('a', 'Write the spec', 'a', { 'p-status': 'done', 'p-priority': 'high', 'p-estimate': 120 }),
  row('b', 'Review the contract', 'b', {
    'p-status': 'doing',
    'p-priority': 'urgent',
    'p-estimate': 30,
    'p-tags': ['work'],
  }),
  row('c', 'Buy milk', 'c', { 'p-status': 'todo', 'p-tags': ['home'] }),
  row('d', 'Call the plumber', 'd', { 'p-priority': 'low' }, true),
];

const query = (overrides: Partial<Query> = {}): Query => ({ ...EMPTY_QUERY, ...overrides });
const prop = (id: string): FieldRef => ({ kind: 'property', propertyId: id });
const builtin = (
  field: 'title' | 'completed' | 'dueAt' | 'startAt' | 'createdAt' | 'updatedAt',
): FieldRef => ({
  kind: 'builtin',
  field,
});

const filter = (field: FieldRef, operator: Filter['operator'], value: Filter['value']): Filter => ({
  id: 'f1',
  field,
  operator,
  value,
});

const idsOf = (result: ReturnType<typeof run>) => flatten(result).map((r) => r.item.id);

// ── Fields ─────────────────────────────────────────────────────────────────

describe('field references', () => {
  it('distinguishes a built-in field from a property with the same name', () => {
    expect(sameField(builtin('title'), prop('title'))).toBe(false);
    expect(fieldKey(builtin('title'))).not.toBe(fieldKey(prop('title')));
  });

  it('treats two references to the same field as equal', () => {
    expect(sameField(prop('p-status'), prop('p-status'))).toBe(true);
  });
});

describe('operatorsFor', () => {
  it('does not offer "is after" on a checkbox', () => {
    const checkbox: Property = { ...ESTIMATE, id: 'p-c', type: 'checkbox' };
    expect(operatorsFor(checkbox)).toEqual(['is']);
  });

  it('offers containment on text and membership on a multi-select', () => {
    const text: Property = { ...ESTIMATE, id: 'p-t', type: 'text' };
    expect(operatorsFor(text)).toContain('contains');
    expect(operatorsFor(TAGS)).toContain('has_any_of');
    expect(operatorsFor(TAGS)).not.toContain('contains');
  });

  it('offers something for every built-in field', () => {
    for (const field of ['title', 'completed', 'createdAt', 'updatedAt'] as const) {
      expect(operatorsFor(null, field).length).toBeGreaterThan(0);
    }
  });
});

// ── Filtering ──────────────────────────────────────────────────────────────

describe('filtering', () => {
  it('returns everything when there are no filters', () => {
    expect(idsOf(run({ rows: ROWS, properties: PROPERTIES, query: query() }))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('matches an option exactly', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ filters: [filter(prop('p-status'), 'is', 'doing')] }),
    });
    expect(idsOf(result)).toEqual(['b']);
    expect(result.matched).toBe(1);
    expect(result.total).toBe(4);
  });

  it('matches text without regard to case', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ filters: [filter(builtin('title'), 'contains', 'CONTRACT')] }),
    });
    expect(idsOf(result)).toEqual(['b']);
  });

  it('finds rows with nothing in a column, and rows with something', () => {
    const empty = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ filters: [filter(prop('p-estimate'), 'is_empty', null)] }),
    });
    expect(idsOf(empty)).toEqual(['c', 'd']);

    const filled = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ filters: [filter(prop('p-estimate'), 'is_not_empty', null)] }),
    });
    expect(idsOf(filled)).toEqual(['a', 'b']);
  });

  it('compares a duration numerically rather than as text', () => {
    // The trap: "30" sorts after "120" as a string.
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ filters: [filter(prop('p-estimate'), 'gt', 60)] }),
    });
    expect(idsOf(result)).toEqual(['a']);
  });

  it('never matches an empty field with a comparison', () => {
    // "Bigger than 10" must not quietly include the rows that answered nothing.
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ filters: [filter(prop('p-estimate'), 'gt', 0)] }),
    });
    expect(idsOf(result)).toEqual(['a', 'b']);
  });

  it('matches any of a multi-select', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ filters: [filter(prop('p-tags'), 'has_any_of', ['home'])] }),
    });
    expect(idsOf(result)).toEqual(['c']);
  });

  it('combines filters with every one, or with any one', () => {
    const filters = [
      { ...filter(prop('p-status'), 'is', 'done'), id: 'f1' },
      { ...filter(prop('p-priority'), 'is', 'urgent'), id: 'f2' },
    ];

    expect(idsOf(run({ rows: ROWS, properties: PROPERTIES, query: query({ filters }) }))).toEqual(
      [],
    );
    expect(
      idsOf(run({ rows: ROWS, properties: PROPERTIES, query: query({ filters, match: 'any' }) })),
    ).toEqual(['a', 'b']);
  });

  it('hides completed rows when asked to', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ includeCompleted: false }),
    });
    expect(idsOf(result)).toEqual(['a', 'b', 'c']);
  });

  it('reads a boolean filter written as text', () => {
    // A checkbox filter arrives from a <select> as the string "true".
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ filters: [filter(builtin('completed'), 'is', 'true')] }),
    });
    expect(idsOf(result)).toEqual(['d']);
  });

  // ── The behaviour that makes a filter builder usable ─────────────────────
  it('accepts everything while a filter is still being written', () => {
    // A filter with no value yet is unfinished, not exclusive. Treating it as
    // exclusive flashes an empty screen at every keystroke.
    const unfinished = filter(prop('p-status'), 'is', null);
    for (const candidate of ROWS) {
      expect(accepts(candidate, unfinished, PROPERTIES)).toBe(true);
    }
  });

  it('ignores a filter pointing at a property that no longer exists', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ filters: [filter(prop('p-deleted'), 'is', 'anything')] }),
    });
    // The field reads as empty, so `is` matches nothing — but nothing throws,
    // and the other views keep working.
    expect(result.total).toBe(4);
    expect(idsOf(result)).toEqual([]);
  });

  it('survives a row whose stored value cannot be read', () => {
    const broken = row('x', 'Broken', 'x', { 'p-estimate': 'not a number' });
    const result = run({
      rows: [...ROWS, broken],
      properties: PROPERTIES,
      query: query({ filters: [filter(prop('p-estimate'), 'is_empty', null)] }),
    });
    expect(idsOf(result)).toContain('x');
  });
});

// ── Sorting ────────────────────────────────────────────────────────────────

describe('sorting', () => {
  it('falls back to the manual order when nothing is sorted', () => {
    const scrambled = [ROWS[2]!, ROWS[0]!, ROWS[3]!, ROWS[1]!];
    expect(idsOf(run({ rows: scrambled, properties: PROPERTIES, query: query() }))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('sorts options by their declared order, not alphabetically', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ sorts: [{ field: prop('p-priority'), direction: 'asc' }] }),
    });
    // urgent, high, low — then the row with no priority.
    expect(idsOf(result)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('keeps empty last when the direction is reversed', () => {
    // The bug this guards: flipping the sort drags every blank row to the top,
    // burying the answered ones.
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ sorts: [{ field: prop('p-priority'), direction: 'desc' }] }),
    });
    expect(idsOf(result).at(-1)).toBe('c');
  });

  it('breaks ties on the manual order so the list never reshuffles itself', () => {
    const tied = [
      row('t3', 'Third', 'c', { 'p-status': 'todo' }),
      row('t1', 'First', 'a', { 'p-status': 'todo' }),
      row('t2', 'Second', 'b', { 'p-status': 'todo' }),
    ];
    const sorted = query({ sorts: [{ field: prop('p-status'), direction: 'asc' }] });

    const once = idsOf(run({ rows: tied, properties: PROPERTIES, query: sorted }));
    const twice = idsOf(run({ rows: [...tied].reverse(), properties: PROPERTIES, query: sorted }));

    expect(once).toEqual(['t1', 't2', 't3']);
    expect(twice).toEqual(once);
  });

  it('applies a second sort only where the first ties', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({
        sorts: [
          { field: builtin('completed'), direction: 'asc' },
          { field: prop('p-priority'), direction: 'asc' },
        ],
      }),
    });
    expect(idsOf(result)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('does not mutate the rows it was given', () => {
    const given = [...ROWS];
    run({
      rows: given,
      properties: PROPERTIES,
      query: query({ sorts: [{ field: prop('p-priority'), direction: 'desc' }] }),
    });
    expect(given.map((r) => r.item.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ── Grouping ───────────────────────────────────────────────────────────────

describe('grouping', () => {
  it('returns one group when nothing is grouped', () => {
    const result = run({ rows: ROWS, properties: PROPERTIES, query: query() });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.rows).toHaveLength(4);
  });

  it('keeps a declared group even when nothing falls into it', () => {
    // An empty column on a board still has to be there — it is where a card is
    // dragged to. Hiding it makes the board unusable.
    const onlyTodo = [ROWS[2]!];
    const result = run({
      rows: onlyTodo,
      properties: PROPERTIES,
      query: query({ groupBy: prop('p-status') }),
    });

    expect(result.groups.map((g) => g.key)).toEqual(['todo', 'doing', 'done', null]);
    expect(result.groups[1]?.rows).toHaveLength(0);
  });

  it('orders groups the way the property declares them', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ groupBy: prop('p-status') }),
    });
    expect(result.groups.map((g) => g.label)).toEqual(['To do', 'In progress', 'Done', 'No value']);
  });

  it('puts rows with no value in their own group, last', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ groupBy: prop('p-status') }),
    });
    const last = result.groups.at(-1);
    expect(last?.key).toBeNull();
    expect(last?.rows.map((r) => r.item.id)).toEqual(['d']);
  });

  it('shows a value the property no longer declares rather than dropping it', () => {
    // The rows in it are real. Dropping the group would make them disappear
    // from the view with no explanation.
    const orphan = row('o', 'Orphan', 'z', { 'p-status': 'archived' });
    const result = run({
      rows: [...ROWS, orphan],
      properties: PROPERTIES,
      query: query({ groupBy: prop('p-status') }),
    });

    const group = result.groups.find((g) => g.key === 'archived');
    expect(group?.label).toBe('archived (removed)');
    expect(group?.rows.map((r) => r.item.id)).toEqual(['o']);
    expect(idsOf(result)).toContain('o');
  });

  it('groups by completion', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ groupBy: builtin('completed') }),
    });
    expect(result.groups.map((g) => g.label)).toEqual(['Open', 'Completed']);
    expect(result.groups[1]?.rows.map((r) => r.item.id)).toEqual(['d']);
  });

  it('sorts within a group, not across groups', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({
        groupBy: builtin('completed'),
        sorts: [{ field: prop('p-priority'), direction: 'asc' }],
      }),
    });
    expect(result.groups[0]?.rows.map((r) => r.item.id)).toEqual(['b', 'a', 'c']);
  });

  it('counts every row it returns', () => {
    const result = run({
      rows: ROWS,
      properties: PROPERTIES,
      query: query({ groupBy: prop('p-status') }),
    });
    const inGroups = result.groups.reduce((sum, group) => sum + group.rows.length, 0);
    expect(inGroups).toBe(result.matched);
    expect(result.matched).toBe(4);
  });
});

describe('an empty collection', () => {
  it('still returns the declared groups', () => {
    const result = run({
      rows: [],
      properties: PROPERTIES,
      query: query({ groupBy: prop('p-status') }),
    });
    expect(result.total).toBe(0);
    expect(result.matched).toBe(0);
    expect(result.groups.length).toBeGreaterThan(0);
  });
});

// ── Dates ──────────────────────────────────────────────────────────────────

describe('filtering on dates', () => {
  // 09:00 in São Paulo, which is where a naive UTC comparison goes wrong.
  const NOW = '2026-09-05T12:00:00.000Z';
  const ZONE = 'America/Sao_Paulo';

  const dated = (id: string, position: string, dueAt: string | null): Row => {
    const base = row(id, id, position);
    return { ...base, item: { ...base.item, dueAt } };
  };

  const ROWS_WITH_DATES = [
    dated('late', 'a', '2026-09-04T12:00:00.000Z'),
    dated('today', 'b', '2026-09-05T22:00:00.000Z'),
    dated('tomorrow', 'c', '2026-09-06T22:00:00.000Z'),
    dated('next-week', 'd', '2026-09-11T12:00:00.000Z'),
    dated('far', 'e', '2026-12-01T12:00:00.000Z'),
    dated('undated', 'f', null),
  ];

  const dateRun = (query: Query) =>
    idsOf(run({ rows: ROWS_WITH_DATES, properties: PROPERTIES, query, now: NOW, zone: ZONE }));

  it('knows which tokens are relative', () => {
    expect(isRelative('@todayEnd')).toBe(true);
    expect(isRelative('@never')).toBe(false);
    expect(isRelative('2026-09-05')).toBe(false);
    expect(isRelative(null)).toBe(false);
  });

  it('resolves a token against the clock it is given, in the zone it is given', () => {
    // The whole point: a saved view called Today means today on the day it is
    // opened, not on the day it was saved.
    expect(resolveRelative('@now', NOW, ZONE)).toBe(NOW);
    expect(resolveRelative('@todayStart', NOW, ZONE)).toBe('2026-09-05T03:00:00.000Z');
    expect(resolveRelative('@todayEnd', NOW, ZONE)).toBe('2026-09-06T03:00:00.000Z');
    expect(resolveRelative('@in7d', NOW, ZONE)).toBe('2026-09-13T03:00:00.000Z');
  });

  it('resolves the same token differently in a different zone', () => {
    expect(resolveRelative('@todayEnd', NOW, 'UTC')).toBe('2026-09-06T00:00:00.000Z');
  });

  it('finds what is due today, and what was already late', () => {
    // This is the Today view. Overdue work belongs in it: a task that was due
    // yesterday is still today's problem.
    expect(dateRun(query({ filters: [filter(builtin('dueAt'), 'lt', '@todayEnd')] }))).toEqual([
      'late',
      'today',
    ]);
  });

  it('finds only what is actually late', () => {
    expect(dateRun(query({ filters: [filter(builtin('dueAt'), 'lt', '@now')] }))).toEqual(['late']);
  });

  it('finds the coming week', () => {
    expect(
      dateRun(
        query({
          filters: [
            { ...filter(builtin('dueAt'), 'lt', '@in7d'), id: 'window' },
            { ...filter(builtin('dueAt'), 'is_not_empty', null), id: 'dated' },
          ],
        }),
      ),
      // 'next-week' is six days out, which is inside a seven-day window. The
      // name is a label, not an assertion.
    ).toEqual(['late', 'today', 'tomorrow', 'next-week']);
  });

  it('never sweeps an undated task into a date filter', () => {
    // "Due before Friday" must not quietly include everything that has no date
    // at all — which is what a naive comparison against null does.
    for (const token of ['@now', '@todayEnd', '@in7d'] as const) {
      expect(dateRun(query({ filters: [filter(builtin('dueAt'), 'lt', token)] }))).not.toContain(
        'undated',
      );
    }
  });

  it('separates the dated from the undated', () => {
    expect(dateRun(query({ filters: [filter(builtin('dueAt'), 'is_empty', null)] }))).toEqual([
      'undated',
    ]);
  });

  it('sorts by date, with the undated last', () => {
    expect(dateRun(query({ sorts: [{ field: builtin('dueAt'), direction: 'asc' }] }))).toEqual([
      'late',
      'today',
      'tomorrow',
      'next-week',
      'far',
      'undated',
    ]);
  });

  it('answers differently at a different moment, from the same saved query', () => {
    // The same stored filter, run a week later, returns a different answer.
    // That is the promise a relative value makes.
    const today = query({ filters: [filter(builtin('dueAt'), 'lt', '@todayEnd')] });

    const nextWeek = idsOf(
      run({
        rows: ROWS_WITH_DATES,
        properties: PROPERTIES,
        query: today,
        now: '2026-09-12T12:00:00.000Z',
        zone: ZONE,
      }),
    );

    expect(nextWeek).toEqual(['late', 'today', 'tomorrow', 'next-week']);
  });

  it('lets accepts be asked about one row at a chosen moment', () => {
    const late = ROWS_WITH_DATES[0]!;
    const rule = filter(builtin('dueAt'), 'lt', '@now');

    expect(accepts(late, rule, PROPERTIES, NOW, ZONE)).toBe(true);
    // Rewind to before it was due, and it is no longer late.
    expect(accepts(late, rule, PROPERTIES, '2026-09-03T12:00:00.000Z', ZONE)).toBe(false);
  });
});
