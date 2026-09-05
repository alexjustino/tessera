import { describe, expect, it } from 'vitest';

import type { CalendarEvent } from './calendar';
import {
  blockText,
  decide,
  describe as describePreview,
  fromTesseraExport,
  normalise,
  preview,
  redirect,
  type ImportPlan,
} from './importing';
import type { Collection, Item } from './item';

const ZONE = 'America/Sao_Paulo';

const item = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
  id,
  collectionId: 'tasks',
  parentItemId: null,
  title,
  position: 'a',
  startAt: null,
  dueAt: null,
  remindAt: null,
  recurrenceRule: null,
  recurrenceMode: 'schedule',
  completedAt: null,
  estimateMinutes: null,
  isMilestone: false,
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  ...extra,
});

const collections: Collection[] = [
  { id: 'tasks', name: 'Tasks', icon: null, color: null, position: 'a' },
];

const event = (id: string, title: string, startsAt: string): CalendarEvent => ({
  id,
  calendarId: 'personal',
  title,
  startsAt,
  endsAt: startsAt,
  tz: ZONE,
  allDay: false,
  rrule: null,
  color: null,
  itemId: null,
});

const plan: ImportPlan = {
  source: 'a test',
  collections: [
    { name: 'tasks', icon: null, color: null }, // exists, differently cased
    { name: 'Errands', icon: null, color: null }, // new
  ],
  tasks: [
    {
      key: 't1',
      collection: 'Tasks',
      title: 'Renew the passport',
      notes: null,
      startAt: null,
      dueAt: '2026-09-15T13:00:00.000Z',
      completedAt: null,
      estimateMinutes: null,
      isMilestone: false,
      values: {},
    },
    {
      key: 't2',
      collection: 'Tasks',
      title: 'Renew the passport',
      notes: null,
      startAt: null,
      dueAt: '2026-10-15T13:00:00.000Z', // same title, another day: not a duplicate
      completedAt: null,
      estimateMinutes: null,
      isMilestone: false,
      values: {},
    },
    {
      key: 't3',
      collection: 'Errands',
      title: 'Buy stamps',
      notes: 'At the post office.',
      startAt: null,
      dueAt: null,
      completedAt: null,
      estimateMinutes: 15,
      isMilestone: false,
      values: { Priority: 'low' },
    },
  ],
  events: [
    {
      key: 'e1',
      title: 'Dentist',
      startsAt: '2026-09-16T14:00:00.000Z',
      endsAt: '2026-09-16T15:00:00.000Z',
      tz: ZONE,
      allDay: false,
      rrule: null,
    },
    {
      key: 'e2',
      title: 'Dentist',
      startsAt: '2026-09-23T14:00:00.000Z',
      endsAt: '2026-09-23T15:00:00.000Z',
      tz: ZONE,
      allDay: false,
      rrule: null,
    },
  ],
  warnings: ['one thing was left out'],
};

const existing = {
  collections,
  items: [
    item('old-1', 'RENEW  the passport', { dueAt: '2026-09-15T16:00:00.000Z' }), // same local day
    item('old-2', 'Pack'),
  ],
  events: [event('ev-1', 'dentist', '2026-09-16T14:00:00.000Z')],
};

describe('normalising a title', () => {
  it('ignores case, edges and runs of space', () => {
    expect(normalise('  Renew   the Passport ')).toBe('renew the passport');
  });
});

describe('the preview', () => {
  const shown = preview(plan, existing, ZONE);

  it('reuses a collection by name, whatever the case, and creates the rest', () => {
    expect(shown.collections).toEqual([
      { name: 'tasks', action: 'reuse' },
      { name: 'Errands', action: 'create' },
    ]);
    expect(shown.counts.collectionsToCreate).toBe(1);
  });

  it('names the existing task an import looks like: same title, collection and due day', () => {
    const byKey = new Map(shown.tasks.map((entry) => [entry.key, entry]));
    expect(byKey.get('t1')!.duplicateOf).toBe('old-1');
    // Another day is another task.
    expect(byKey.get('t2')!.duplicateOf).toBeNull();
    // A new collection has nothing to duplicate.
    expect(byKey.get('t3')!.duplicateOf).toBeNull();
  });

  it('names the existing event an import looks like: same title at the same instant', () => {
    const byKey = new Map(shown.events.map((entry) => [entry.key, entry]));
    expect(byKey.get('e1')!.duplicateOf).toBe('ev-1');
    expect(byKey.get('e2')!.duplicateOf).toBeNull();
  });

  it('counts, and carries the importer’s warnings through', () => {
    expect(shown.counts).toEqual({ collectionsToCreate: 1, tasks: 3, events: 2, duplicates: 2 });
    expect(shown.warnings).toEqual(['one thing was left out']);
  });

  it('says what it would do in a sentence', () => {
    expect(describePreview(shown)).toBe('3 tasks, 2 events and a new collection, from a test.');
    expect(
      describePreview(preview({ ...plan, tasks: [], events: [], collections: [] }, existing, ZONE)),
    ).toBe('Nothing to import.');
  });
});

describe('deciding', () => {
  it('leaves the duplicates out when asked, and only then', () => {
    const shown = preview(plan, existing, ZONE);
    const skipped = decide(plan, shown, true);
    expect(skipped.tasks.map((task) => task.key)).toEqual(['t2', 't3']);
    expect(skipped.events.map((entry) => entry.key)).toEqual(['e2']);
    expect(decide(plan, shown, false)).toBe(plan);
  });
});

describe('reading a Tessera export', () => {
  const document = {
    format: 'tessera-export',
    version: 1,
    tables: {
      collection: [
        { id: 'c1', name: 'Tasks', icon: null, color: null, archived_at: null },
        { id: 'c2', name: 'Old', icon: null, color: null, archived_at: '2026-01-01T00:00:00.000Z' },
      ],
      property: [{ id: 'p1', collection_id: 'c1', name: 'Priority' }],
      item: [
        {
          id: 'i1',
          collection_id: 'c1',
          title: 'Write the brief',
          due_at: '2026-09-10T17:00:00.000Z',
          estimate_minutes: 120,
          is_milestone: 0,
          archived_at: null,
        },
        {
          id: 'i2',
          collection_id: 'c1',
          title: 'Archived',
          archived_at: '2026-02-02T00:00:00.000Z',
        },
        { id: 'i3', collection_id: 'gone', title: 'Orphan' },
        {
          id: 'i4',
          collection_id: 'c1',
          title: 'Launch',
          is_milestone: 1,
          completed_at: '2026-09-01T09:00:00.000Z',
        },
      ],
      item_property_value: [
        { item_id: 'i1', property_id: 'p1', value_json: '"high"' },
        { item_id: 'i1', property_id: 'missing', value_json: '1' },
      ],
      block: [
        {
          owner_kind: 'item',
          owner_id: 'i1',
          type: 'paragraph',
          content_json:
            '{"type":"paragraph","content":[{"type":"text","text":"Ask "},{"type":"text","text":"Ana."}]}',
        },
      ],
      event: [
        {
          id: 'ev1',
          title: 'Standup',
          starts_at_utc: '2026-09-07T12:00:00.000Z',
          ends_at_utc: '2026-09-07T12:15:00.000Z',
          tz: 'America/Sao_Paulo',
          all_day: 0,
          rrule: 'FREQ=DAILY',
        },
      ],
      event_exception: [{ event_id: 'ev1', original_start: '2026-09-08T12:00:00.000Z' }],
      item_dependency: [{ blocker_id: 'i1', blocked_id: 'i4' }],
    },
  };

  it('carries collections, tasks with their values and notes, and events', () => {
    const plan = fromTesseraExport(document)!;
    expect(plan.source).toBe('a Tessera export');
    expect(plan.collections.map((c) => c.name)).toEqual(['Tasks']);
    expect(plan.tasks.map((t) => t.title)).toEqual(['Write the brief', 'Launch']);
    const brief = plan.tasks[0]!;
    expect(brief.collection).toBe('Tasks');
    expect(brief.dueAt).toBe('2026-09-10T17:00:00.000Z');
    expect(brief.estimateMinutes).toBe(120);
    expect(brief.values).toEqual({ Priority: 'high' });
    expect(brief.notes).toBe('Ask Ana.');
    expect(plan.tasks[1]!.isMilestone).toBe(true);
    expect(plan.tasks[1]!.completedAt).toBe('2026-09-01T09:00:00.000Z');
    expect(plan.events).toEqual([
      {
        key: 'event:ev1',
        title: 'Standup',
        startsAt: '2026-09-07T12:00:00.000Z',
        endsAt: '2026-09-07T12:15:00.000Z',
        tz: 'America/Sao_Paulo',
        allDay: false,
        rrule: 'FREQ=DAILY',
      },
    ]);
  });

  it('says what it left out, one sentence each, never silently', () => {
    const plan = fromTesseraExport(document)!;
    expect(plan.warnings).toEqual([
      '1 property value named a property the file does not describe, and was left out.',
      '1 task belongs to a collection the file does not describe, and was left out.',
      '1 archived task was left out.',
      '1 exception to repeating events was left out; the series import whole.',
      '1 dependency was left out; the door carries rows, not the links between them yet.',
    ]);
  });

  it('refuses what is not a Tessera export', () => {
    expect(fromTesseraExport(null)).toBeNull();
    expect(fromTesseraExport({ format: 'something-else', tables: {} })).toBeNull();
    expect(fromTesseraExport({ format: 'tessera-export' })).toBeNull();
    // Malformed rows are skipped, not fatal.
    expect(
      fromTesseraExport({ format: 'tessera-export', tables: { item: [null, 3, { title: 1 }] } }),
    ).toEqual({ source: 'a Tessera export', collections: [], tasks: [], events: [], warnings: [] });
  });
});

describe('block text', () => {
  it('is the leaves in order, whatever wraps them', () => {
    expect(
      blockText(
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}]}',
      ),
    ).toBe('a b');
    expect(blockText({ type: 'text', text: '  x  ' })).toBe('x');
    expect(blockText('not json')).toBe('not json');
    expect(blockText(null)).toBe('');
  });
});

describe('redirecting', () => {
  it('sends every task to one collection and drops the file’s own', () => {
    const moved = redirect(plan, 'Tasks');
    expect(moved.collections).toEqual([{ name: 'Tasks', icon: null, color: null }]);
    expect(new Set(moved.tasks.map((task) => task.collection))).toEqual(new Set(['Tasks']));
    expect(moved.events).toBe(plan.events);
    // The preview then reuses the existing collection rather than creating one.
    expect(preview(moved, existing, ZONE).counts.collectionsToCreate).toBe(0);
  });

  it('changes nothing for a blank destination', () => {
    expect(redirect(plan, '   ')).toBe(plan);
  });
});
