import { describe, expect, it } from 'vitest';

import { asWallClock } from '../schedule';

import { fromTodoist, looksLikeTodoist, readTodoistDate } from './todoist';

const ZONE = 'America/Sao_Paulo';

const wall = (instant: string | null) => {
  const local = asWallClock(instant!, ZONE);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`;
};

const FILE = `TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,meta
section,Before the trip,,,,,,,,,,,
task,Renew the passport,Bring two photos,4,1,Someone (1),,Sep 15 2026 10:00,en,America/Sao_Paulo,90,minute,"view_style=list"
note,The office closes at noon on Fridays.,,,,Someone (1),,,,,,,
task,Book the flights,,3,1,Someone (1),,Sep 20 2026,en,America/Sao_Paulo,,,
task,Compare prices,,2,2,Someone (1),,,en,America/Sao_Paulo,,,
task,Water the plants,,1,1,Someone (1),,every other day,en,America/Sao_Paulo,,,
task,Write the trip up,,1,1,Someone (1),,2026-10-02T18:30:00,en,America/Sao_Paulo,,,
`;

describe('recognising a Todoist export', () => {
  it('knows the template header, and nothing else', () => {
    expect(looksLikeTodoist(FILE)).toBe(true);
    expect(looksLikeTodoist('Subject,Due Date,Complete\nx,,False\n')).toBe(false);
    expect(looksLikeTodoist('')).toBe(false);
  });
});

describe('a Todoist project', () => {
  const plan = fromTodoist(FILE, 'Trip', ZONE)!;

  it('lands in a collection named after the project, one task per task row', () => {
    expect(plan.collections).toEqual([{ name: 'Trip', icon: null, color: null }]);
    expect(plan.tasks.map((task) => task.title)).toEqual([
      'Renew the passport',
      'Book the flights',
      'Compare prices',
      'Water the plants',
      'Write the trip up',
    ]);
    expect(plan.source).toBe('a Todoist export (Trip)');
  });

  it('reads the date in the row’s own zone, end of day when there is no time', () => {
    const byTitle = new Map(plan.tasks.map((task) => [task.title, task]));
    expect(wall(byTitle.get('Renew the passport')!.dueAt)).toBe('2026-09-15 10:00');
    expect(wall(byTitle.get('Book the flights')!.dueAt)).toBe('2026-09-20 23:59');
    expect(wall(byTitle.get('Write the trip up')!.dueAt)).toBe('2026-10-02 18:30');
    expect(byTitle.get('Compare prices')!.dueAt).toBeNull();
  });

  it('maps priority 4→urgent, 3→high, 2→medium, and leaves 1 unset', () => {
    const byTitle = new Map(plan.tasks.map((task) => [task.title, task]));
    expect(byTitle.get('Renew the passport')!.values).toEqual({ Priority: 'urgent' });
    expect(byTitle.get('Book the flights')!.values).toEqual({ Priority: 'high' });
    expect(byTitle.get('Compare prices')!.values).toEqual({ Priority: 'medium' });
    expect(byTitle.get('Water the plants')!.values).toEqual({});
  });

  it('keeps the description and attaches the note to the task before it', () => {
    const passport = plan.tasks[0]!;
    expect(passport.notes).toBe('Bring two photos\n\nThe office closes at noon on Fridays.');
    expect(passport.estimateMinutes).toBe(90);
  });

  it('nothing is completed: a template export has no completed tasks', () => {
    expect(plan.tasks.every((task) => task.completedAt === null)).toBe(true);
  });

  it('says what it left out, one sentence each', () => {
    expect(plan.warnings).toEqual([
      '1 section heading was left out; the tasks under it were kept.',
      '1 sub-task was imported as a task at the top level; nesting is not carried.',
      '1 task repeats in Todoist; the next date was kept, the rule was not.',
      '1 date was not understood and the task is undated: row 7 (“every other day”).',
    ]);
  });

  it('falls back to a name and a zone when the file gives none', () => {
    const bare = fromTodoist('TYPE,CONTENT\ntask,Only\n', '   ', ZONE)!;
    expect(bare.collections[0]!.name).toBe('Todoist');
    expect(bare.tasks).toHaveLength(1);
    expect(fromTodoist('Subject,Due Date\nx,\n', 'x', ZONE)).toBeNull();
    expect(fromTodoist('', 'x', ZONE)).toBeNull();
  });
});

describe('reading a Todoist date', () => {
  it('reads the forms Todoist writes', () => {
    expect(wall(readTodoistDate('Sep 15 2026 10:00', ZONE))).toBe('2026-09-15 10:00');
    expect(wall(readTodoistDate('Sep 15, 2026', ZONE))).toBe('2026-09-15 23:59');
    expect(wall(readTodoistDate('15 Sep 2026 09:05', ZONE))).toBe('2026-09-15 09:05');
    expect(wall(readTodoistDate('2026-02-28', ZONE))).toBe('2026-02-28 23:59');
    expect(wall(readTodoistDate('2026-09-15T10:00:00', ZONE))).toBe('2026-09-15 10:00');
  });

  it('refuses what is not a date, including a day that does not exist', () => {
    expect(readTodoistDate('every day', ZONE)).toBeNull();
    expect(readTodoistDate('Feb 30 2026', ZONE)).toBeNull();
    expect(readTodoistDate('Xyz 1 2026', ZONE)).toBeNull();
    expect(readTodoistDate('', ZONE)).toBeNull();
  });

  it('honours the zone: the same wall clock is a different instant elsewhere', () => {
    const saoPaulo = readTodoistDate('Sep 15 2026 10:00', 'America/Sao_Paulo')!;
    const tokyo = readTodoistDate('Sep 15 2026 10:00', 'Asia/Tokyo')!;
    expect(Date.parse(saoPaulo) - Date.parse(tokyo)).toBe(12 * 3_600_000);
  });
});
