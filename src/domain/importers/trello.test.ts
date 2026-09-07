import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fromTrello, groupOf, looksLikeTrello, slug } from './trello';

const board: unknown = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../e2e/fixtures/trello-board.json'), 'utf-8'),
);

/** The seeded Status options, as the workspace has them. */
const STATUS = [
  { id: 'todo', label: 'To do', color: null, group: 'todo' as const },
  { id: 'doing', label: 'In progress', color: 'info', group: 'doing' as const },
  { id: 'blocked', label: 'Blocked', color: 'danger', group: 'doing' as const },
  { id: 'done', label: 'Done', color: 'success', group: 'done' as const },
];

describe('recognising a Trello export', () => {
  it('knows a board by its lists, cards and name', () => {
    expect(looksLikeTrello(board)).toBe(true);
    expect(looksLikeTrello({ lists: [], cards: [] })).toBe(false);
    expect(looksLikeTrello('nope')).toBe(false);
    expect(fromTrello({ name: 'x' }, STATUS)).toBeNull();
  });
});

describe('a Trello board', () => {
  const plan = fromTrello(board, STATUS)!;
  const byTitle = new Map(plan.tasks.map((task) => [task.title, task]));

  it('is a collection named after the board', () => {
    expect(plan.collections).toEqual([{ name: 'Website relaunch', icon: null, color: null }]);
    expect(plan.source).toBe('a Trello board (Website relaunch)');
  });

  it('turns lists into Status options, reusing the ones already there by name', () => {
    const status = plan.properties!.find((property) => property.name === 'Status')!;
    expect(status.type).toBe('status');
    // "In progress" and "Done" exist already; Ideas and Review are new.
    expect(status.options!.map((option) => option.id)).toEqual(['trello-ideas', 'trello-review']);
    expect(status.options!.map((option) => option.group)).toEqual(['todo', 'doing']);
    expect(byTitle.get('Sketch the new home page')!.values.Status).toBe('doing');
    expect(byTitle.get('Set up the repository')!.values.Status).toBe('done');
    expect(byTitle.get('Write the copy')!.values.Status).toBe('trello-ideas');
  });

  it('keeps the cards in list order, then card order, and leaves archived ones out', () => {
    expect(plan.tasks.map((task) => task.title)).toEqual([
      'Pick a typeface', // Ideas, pos 65536
      'Write the copy', // Ideas, pos 131072
      'Sketch the new home page', // In progress
      'Set up the repository', // Done
    ]);
  });

  it('turns labels into a multi-select, naming an unnamed one by its colour', () => {
    const labels = plan.properties!.find((property) => property.name === 'Labels')!;
    expect(labels.type).toBe('multi_select');
    expect(labels.options!).toEqual([
      { id: 'trello-design', label: 'Design', color: 'accent' },
      { id: 'trello-urgent', label: 'Urgent', color: 'danger' },
      { id: 'trello-green', label: 'green', color: 'success' },
    ]);
    expect(byTitle.get('Sketch the new home page')!.values.Labels).toEqual([
      'trello-design',
      'trello-urgent',
    ]);
    expect(byTitle.get('Write the copy')!.values.Labels).toBeUndefined();
  });

  it('keeps the dates, and a card marked complete is completed on its due date', () => {
    const sketch = byTitle.get('Sketch the new home page')!;
    expect(sketch.dueAt).toBe('2026-09-18T15:00:00.000Z');
    expect(sketch.startAt).toBe('2026-09-14T12:00:00.000Z');
    expect(sketch.completedAt).toBeNull();
    expect(byTitle.get('Set up the repository')!.completedAt).toBe('2026-09-05T12:00:00.000Z');
  });

  it('turns the description into notes and each checklist into a heading and a task list', () => {
    const sketch = byTitle.get('Sketch the new home page')!;
    expect(sketch.notes).toBe('Three directions, one afternoon.');
    expect(sketch.blocks!.map((block) => block.type)).toEqual(['heading', 'taskList']);
    const list = sketch.blocks![1]!.content as { content: { attrs: { checked: boolean } }[] };
    expect(list.content.map((item) => item.attrs.checked)).toEqual([true, false, false]);
    expect(byTitle.get('Write the copy')!.blocks).toEqual([]);
  });

  it('says what it left out, one sentence each', () => {
    expect(plan.warnings).toEqual([
      '1 archived list was left out.',
      '1 archived card was left out.',
      '1 card belongs to a list the file does not describe, and was left out.',
      '2 attachments were left out.',
      '4 comments were left out.',
      '1 card had members; there is one person here.',
    ]);
  });
});

describe('helpers', () => {
  it('makes a stable id from a name', () => {
    expect(slug('In Progress')).toBe('in-progress');
    expect(slug('  Idéias & tal  ')).toBe('ideias-tal');
    expect(slug('')).toBe('');
  });

  it('reads which end of a workflow a list is from its name', () => {
    expect(groupOf('Done')).toBe('done');
    expect(groupOf('Shipped 🚀')).toBe('done');
    expect(groupOf('In progress')).toBe('doing');
    expect(groupOf('Code review')).toBe('doing');
    expect(groupOf('Ideas')).toBe('todo');
  });
});
