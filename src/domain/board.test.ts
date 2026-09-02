import { describe, expect, it } from 'vitest';

import {
  cardProperties,
  columnKeyToStorage,
  EMPTY_BOARD_CONFIG,
  isDroppable,
  planMove,
  toColumns,
  wipState,
  type BoardConfig,
  type Column,
} from './board';
import type { Item } from './item';
import { isValidKey } from './ordering';
import type { Property } from './property';
import { run, type FieldRef, type Row } from './query';

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

const GROUP_BY: FieldRef = { kind: 'property', propertyId: 'p-status' };

function row(id: string, position: string, status?: string): Row {
  const item: Item = {
    id,
    collectionId: 'tasks',
    parentItemId: null,
    title: id,
    position,
    completedAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  };
  return { item, values: status === undefined ? {} : { 'p-status': status } };
}

/** Build the columns the way the board actually does: through the engine. */
function board(rows: Row[], config: BoardConfig = EMPTY_BOARD_CONFIG): Column[] {
  const result = run({
    rows,
    properties: [STATUS, PRIORITY],
    query: {
      filters: [],
      match: 'all',
      sorts: [],
      groupBy: GROUP_BY,
      includeCompleted: true,
    },
  });
  return toColumns(result.groups, config);
}

const ROWS = [row('a', 'a', 'todo'), row('b', 'b', 'todo'), row('c', 'c', 'doing'), row('d', 'd')];

describe('columns come from the engine, not from a store of their own', () => {
  it('makes one column per declared option, plus one for no value', () => {
    const columns = board(ROWS);
    expect(columns.map((column) => column.key)).toEqual(['todo', 'doing', 'done', null]);
  });

  it('keeps a declared column even when nothing is in it', () => {
    // It is the drop target. A column that appears only once something is in it
    // cannot be dragged to.
    const columns = board(ROWS);
    expect(columns.find((column) => column.key === 'done')?.rows).toHaveLength(0);
  });

  it('puts cards with no value in their own column', () => {
    const columns = board(ROWS);
    expect(columns.at(-1)?.rows.map((r) => r.item.id)).toEqual(['d']);
  });
});

describe('work-in-progress limits', () => {
  const limited = (limit: number, count: number) =>
    board(
      Array.from({ length: count }, (_, index) => row(`i${index}`, `a${index}`, 'todo')),
      { ...EMPTY_BOARD_CONFIG, wipLimits: { todo: limit } },
    ).find((column) => column.key === 'todo')!;

  it('reports no limit when none is set', () => {
    expect(wipState(board(ROWS)[0]!)).toBe('none');
  });

  it('distinguishes under, at and over the limit', () => {
    expect(wipState(limited(3, 2))).toBe('under');
    expect(wipState(limited(3, 3))).toBe('at');
    expect(wipState(limited(3, 4))).toBe('over');
  });

  it('stores the no-value column under an empty key, because JSON has no null key', () => {
    expect(columnKeyToStorage(null)).toBe('');
    expect(columnKeyToStorage('todo')).toBe('todo');

    const columns = board(ROWS, { ...EMPTY_BOARD_CONFIG, wipLimits: { '': 1 } });
    expect(columns.find((column) => column.key === null)?.wipLimit).toBe(1);
  });

  it('collapses the columns the board says to collapse', () => {
    const columns = board(ROWS, { ...EMPTY_BOARD_CONFIG, collapsed: ['done', ''] });
    expect(columns.find((c) => c.key === 'done')?.collapsed).toBe(true);
    expect(columns.find((c) => c.key === null)?.collapsed).toBe(true);
    expect(columns.find((c) => c.key === 'todo')?.collapsed).toBe(false);
  });
});

describe('planning a move', () => {
  const columns = board(ROWS);
  const cardA = ROWS[0]!;
  const cardC = ROWS[2]!;

  it('sets the field when a card changes column', () => {
    const move = planMove(cardA, { columnKey: 'doing', index: 0 }, columns, GROUP_BY);

    expect(move).not.toBeNull();
    expect(move?.value).toBe('doing');
    expect(move?.changedColumn).toBe(true);
    expect(move?.field).toEqual(GROUP_BY);
    expect(isValidKey(move!.position)).toBe(true);
  });

  it('clears the field when a card is dropped into the no-value column', () => {
    // Un-setting a status has to be expressible, or the only way back is the
    // detail panel.
    const move = planMove(cardA, { columnKey: null, index: 0 }, columns, GROUP_BY);
    expect(move?.value).toBeNull();
  });

  it('places a card at the head of its new column', () => {
    const move = planMove(cardA, { columnKey: 'doing', index: 0 }, columns, GROUP_BY)!;
    expect(move.position < cardC.item.position).toBe(true);
  });

  it('places a card at the tail of its new column', () => {
    const move = planMove(cardA, { columnKey: 'doing', index: 1 }, columns, GROUP_BY)!;
    expect(move.position > cardC.item.position).toBe(true);
  });

  it('places a card between two others', () => {
    const three = [
      row('x', 'a', 'doing'),
      row('y', 'b', 'doing'),
      row('z', 'c', 'doing'),
      row('mover', 'z', 'todo'),
    ];
    const target = board(three);
    const move = planMove(three[3]!, { columnKey: 'doing', index: 2 }, target, GROUP_BY)!;

    expect(move.position > 'b').toBe(true);
    expect(move.position < 'c').toBe(true);
  });

  // ── The bug this module exists to prevent ────────────────────────────────
  it('counts the slot with the dragged card already removed', () => {
    // Computing the neighbours from the column as displayed — which still holds
    // the card — puts a card dragged one slot down back exactly where it
    // started, because its own key becomes one of the two bounds. It is the
    // classic drag-and-drop off-by-one, and it looks like "the drag did
    // nothing".
    const same = [row('a', 'a', 'todo'), row('b', 'b', 'todo'), row('c', 'c', 'todo')];
    const target = board(same);

    // Move `a` from slot 0 to the end.
    const move = planMove(same[0]!, { columnKey: 'todo', index: 2 }, target, GROUP_BY);

    expect(move).not.toBeNull();
    expect(move!.position > 'c').toBe(true);
    expect(move!.changedColumn).toBe(false);
  });

  it('writes nothing when a card is dropped where it already is', () => {
    // Writing anyway would touch updated_at and reorder a stable list for
    // nothing — and on a board, that means every card twitching.
    //
    // The slot is counted with the card removed, so for `b` in [a, b, c] the
    // only no-op is slot 1: between `a` and `c`, which is where it already sits.
    const same = [row('a', 'a', 'todo'), row('b', 'b', 'todo'), row('c', 'c', 'todo')];
    const target = board(same);

    expect(planMove(same[1]!, { columnKey: 'todo', index: 1 }, target, GROUP_BY)).toBeNull();
  });

  it('does write when a card moves to a slot it is not already in', () => {
    // The companion to the test above, and the reason that one has to be
    // precise: too eager a no-op check silently swallows real moves.
    const same = [row('a', 'a', 'todo'), row('b', 'b', 'todo'), row('c', 'c', 'todo')];
    const target = board(same);

    const toTheEnd = planMove(same[1]!, { columnKey: 'todo', index: 2 }, target, GROUP_BY);
    expect(toTheEnd).not.toBeNull();
    expect(toTheEnd!.position > 'c').toBe(true);

    const toTheHead = planMove(same[1]!, { columnKey: 'todo', index: 0 }, target, GROUP_BY);
    expect(toTheHead).not.toBeNull();
    expect(toTheHead!.position < 'a').toBe(true);
  });

  it('still writes when a card is dropped in the same slot of a different column', () => {
    const move = planMove(cardA, { columnKey: 'done', index: 0 }, columns, GROUP_BY);
    expect(move).not.toBeNull();
    expect(move?.changedColumn).toBe(true);
  });

  it('clamps a slot beyond the end of the column', () => {
    const move = planMove(cardA, { columnKey: 'doing', index: 99 }, columns, GROUP_BY);
    expect(move).not.toBeNull();
    expect(isValidKey(move!.position)).toBe(true);
  });

  it('refuses a column that is not on the board', () => {
    expect(planMove(cardA, { columnKey: 'nowhere', index: 0 }, columns, GROUP_BY)).toBeNull();
  });

  it('produces keys that stay ordered across many moves', () => {
    // The invariant the board rests on: however a person rearranges the cards,
    // the column stays totally ordered.
    let cards = [row('a', 'a', 'todo'), row('b', 'b', 'todo'), row('c', 'c', 'todo')];
    let seed = 20260904;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let step = 0; step < 300; step += 1) {
      const current = board(cards);
      const column = current.find((c) => c.key === 'todo')!;
      const pick = Math.floor(random() * column.rows.length);
      const slot = Math.floor(random() * (column.rows.length + 1));

      const move = planMove(
        column.rows[pick]!,
        { columnKey: 'todo', index: slot },
        current,
        GROUP_BY,
      );
      if (move === null) continue;

      expect(isValidKey(move.position)).toBe(true);
      cards = cards.map((candidate) =>
        candidate.item.id === move.itemId
          ? { ...candidate, item: { ...candidate.item, position: move.position } }
          : candidate,
      );
    }

    const finalColumn = board(cards).find((c) => c.key === 'todo')!;
    const positions = finalColumn.rows.map((r) => r.item.position);
    expect([...positions].sort()).toEqual(positions);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('a column the field no longer declares', () => {
  const withOrphan = [...ROWS, row('orphan', 'z', 'archived')];

  it('is kept so its cards stay visible', () => {
    const columns = board(withOrphan);
    expect(columns.some((column) => column.key === 'archived')).toBe(true);
  });

  it('is not a legal destination', () => {
    // Writing a value that is not an option would spread bad data rather than
    // contain it.
    const columns = board(withOrphan);
    const orphaned = columns.find((column) => column.key === 'archived')!;

    expect(isDroppable(orphaned, STATUS)).toBe(false);
    expect(isDroppable(columns[0]!, STATUS)).toBe(true);
  });

  it('always allows the no-value column', () => {
    const columns = board(withOrphan);
    expect(
      isDroppable(
        columns.find((c) => c.key === null)!,
        STATUS,
      ),
    ).toBe(true);
  });

  it('allows every column of a fixed scale like priority', () => {
    const column: Column = {
      key: 'urgent',
      label: 'Urgent',
      color: 'danger',
      rows: [],
      wipLimit: null,
      collapsed: false,
    };
    expect(isDroppable(column, PRIORITY)).toBe(true);
  });
});

describe('card properties', () => {
  it('shows the properties the board names, in that order', () => {
    const config = { ...EMPTY_BOARD_CONFIG, cardProperties: ['p-priority', 'p-status'] };
    expect(cardProperties(config, [STATUS, PRIORITY]).map((p) => p.id)).toEqual([
      'p-priority',
      'p-status',
    ]);
  });

  it('skips a property that has since been deleted', () => {
    const config = { ...EMPTY_BOARD_CONFIG, cardProperties: ['p-gone', 'p-status'] };
    expect(cardProperties(config, [STATUS]).map((p) => p.id)).toEqual(['p-status']);
  });

  it('shows none when the board names none', () => {
    expect(cardProperties(EMPTY_BOARD_CONFIG, [STATUS, PRIORITY])).toEqual([]);
  });
});
