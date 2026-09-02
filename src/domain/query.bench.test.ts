import { describe, expect, it } from 'vitest';

import { firstKey, between } from './ordering';
import type { Item } from './item';
import type { Property } from './property';
import { EMPTY_QUERY, run, type Query, type Row } from './query';

/**
 * The measured trigger for ADR-004.
 *
 * The decision to filter in memory rather than in SQL is not "it will probably
 * be fine". It comes with a number and a way to read it: fifty thousand items,
 * and a filter that has to stay under 50 ms. When it stops holding, the query
 * compiler that emits SQL behind the same `run(input) -> Result` contract stops
 * being a note in an ADR and becomes the next piece of work.
 *
 * The assertions here are deliberately loose — a shared CI runner is not a
 * stopwatch, and a gate that fails because a machine was busy is a gate people
 * learn to ignore. What they *do* catch is the thing worth catching: an
 * accidental quadratic. At this size an O(n²) path takes minutes, not
 * milliseconds, so the ceiling separates "slower than we would like" from
 * "algorithmically wrong" without ever being flaky.
 *
 * The real figures are printed. Read them, do not just watch the test pass.
 */

const SIZE = 50_000;

/** Catches an accidental quadratic without punishing a busy machine. */
const CEILING_MS = 2_000;

/** The target ADR-004 commits to, reported rather than asserted. */
const TARGET_MS = 50;

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

const PROPERTIES = [STATUS, PRIORITY, ESTIMATE];

const STATUSES = ['todo', 'doing', 'done'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const WORDS = ['review', 'contract', 'invoice', 'plumber', 'spec', 'migration', 'budget'];

/**
 * A deterministic pseudo-random generator.
 *
 * Seeded, so a slow run can be reproduced rather than shrugged at, and so the
 * shape of the data does not change between runs and quietly move the number.
 */
function generator(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function seed(size: number): Row[] {
  const random = generator(20260902);
  const rows: Row[] = [];
  let position = firstKey();

  for (let index = 0; index < size; index += 1) {
    const item: Item = {
      id: `i${index}`,
      collectionId: 'tasks',
      parentItemId: null,
      title: `${WORDS[index % WORDS.length]} ${index}`,
      position,
      startAt: null,
      dueAt: null,
      remindAt: null,
      recurrenceRule: null,
      recurrenceMode: 'schedule',
      completedAt: random() < 0.3 ? '2026-09-01T10:00:00.000Z' : null,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };
    position = between(position, null);

    // A realistic third of rows leave a field blank. Fully populated data hides
    // the empty-handling branches, which are the slow ones.
    const values: Record<string, unknown> = {};
    if (random() < 0.9) values['p-status'] = STATUSES[Math.floor(random() * STATUSES.length)];
    if (random() < 0.7) values['p-priority'] = PRIORITIES[Math.floor(random() * PRIORITIES.length)];
    if (random() < 0.6) values['p-estimate'] = Math.floor(random() * 480);

    rows.push({ item, values });
  }

  return rows;
}

/** How many times each measurement runs. The best is reported. */
const RUNS = 5;

/**
 * Measure, honestly.
 *
 * A single timing on a machine that is also compiling Rust is not a
 * measurement, it is a rumour: consecutive runs of the same code varied by 30%
 * here, which is more than any of the optimisations being evaluated. Running
 * several times and reporting the best gives a number that reflects the code
 * rather than what else the laptop was doing.
 *
 * Best rather than mean, deliberately: the mean measures the machine's other
 * work as much as ours, while the best is the closest available reading of what
 * the code actually costs. The median is printed alongside so a wide spread is
 * visible rather than hidden.
 */
function time(label: string, work: () => unknown): number {
  const timings: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    work();
    timings.push(performance.now() - started);
  }

  timings.sort((a, b) => a - b);
  const best = timings[0]!;
  const median = timings[Math.floor(RUNS / 2)]!;
  const verdict = best <= TARGET_MS ? 'within target' : `over the ${TARGET_MS} ms target`;

  // eslint-disable-next-line no-console
  console.log(
    `  ${label.padEnd(28)} best ${best.toFixed(1).padStart(6)} ms` +
      `   median ${median.toFixed(1).padStart(6)} ms   ${verdict}`,
  );
  return best;
}

describe(`the query engine at ${SIZE.toLocaleString()} items`, () => {
  const rows = seed(SIZE);
  const query = (overrides: Partial<Query> = {}): Query => ({ ...EMPTY_QUERY, ...overrides });

  it('seeds the volume the decision was made against', () => {
    expect(rows).toHaveLength(SIZE);
    // Fractional keys must still be strictly ascending after fifty thousand
    // appends, or the ordering path is measuring nonsense.
    expect(rows[1]!.item.position > rows[0]!.item.position).toBe(true);
    expect(rows.at(-1)!.item.position > rows.at(-2)!.item.position).toBe(true);
  });

  it('filters within the ceiling', () => {
    const elapsed = time('filter by one option', () =>
      run({
        rows,
        properties: PROPERTIES,
        query: query({
          filters: [
            {
              id: 'f1',
              field: { kind: 'property', propertyId: 'p-status' },
              operator: 'is',
              value: 'doing',
            },
          ],
        }),
      }),
    );
    expect(elapsed).toBeLessThan(CEILING_MS);
  });

  it('filters on text within the ceiling', () => {
    const elapsed = time('filter title contains', () =>
      run({
        rows,
        properties: PROPERTIES,
        query: query({
          filters: [
            {
              id: 'f1',
              field: { kind: 'builtin', field: 'title' },
              operator: 'contains',
              value: 'contract',
            },
          ],
        }),
      }),
    );
    expect(elapsed).toBeLessThan(CEILING_MS);
  });

  it('sorts within the ceiling', () => {
    const elapsed = time('sort by priority', () =>
      run({
        rows,
        properties: PROPERTIES,
        query: query({
          sorts: [{ field: { kind: 'property', propertyId: 'p-priority' }, direction: 'asc' }],
        }),
      }),
    );
    expect(elapsed).toBeLessThan(CEILING_MS);
  });

  it('groups within the ceiling', () => {
    const elapsed = time('group by status', () =>
      run({
        rows,
        properties: PROPERTIES,
        query: query({ groupBy: { kind: 'property', propertyId: 'p-status' } }),
      }),
    );
    expect(elapsed).toBeLessThan(CEILING_MS);
  });

  it('filters, sorts and groups together within the ceiling', () => {
    const elapsed = time('filter + sort + group', () =>
      run({
        rows,
        properties: PROPERTIES,
        query: query({
          filters: [
            {
              id: 'f1',
              field: { kind: 'property', propertyId: 'p-estimate' },
              operator: 'gt',
              value: 60,
            },
          ],
          sorts: [{ field: { kind: 'property', propertyId: 'p-priority' }, direction: 'asc' }],
          groupBy: { kind: 'property', propertyId: 'p-status' },
        }),
      }),
    );
    expect(elapsed).toBeLessThan(CEILING_MS);
  });

  it('returns the same answer at scale as it does in the small', () => {
    // Speed is worthless if the answer changed. Every row must land in exactly
    // one group, and the counts must reconcile.
    const result = run({
      rows,
      properties: PROPERTIES,
      query: query({ groupBy: { kind: 'property', propertyId: 'p-status' } }),
    });

    const grouped = result.groups.reduce((sum, group) => sum + group.rows.length, 0);
    expect(result.total).toBe(SIZE);
    expect(result.matched).toBe(SIZE);
    expect(grouped).toBe(SIZE);

    const seen = new Set(result.groups.flatMap((group) => group.rows.map((row) => row.item.id)));
    expect(seen.size).toBe(SIZE);
  });
});
