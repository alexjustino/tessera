/**
 * Todoist, from the CSV a project exports ("Export as a template").
 *
 * One file is one project: rows of `TYPE` task, note or section, with the
 * task's content, description, priority (4 is the most urgent — Todoist's p1),
 * indent (1 is top level), a date written the way the person typed it, and the
 * timezone it was typed in. Notes follow the task they belong to. Completed
 * tasks are not in a template export, so nothing here is ever completed.
 *
 * What is carried: title, description and notes, priority, due date and time
 * in the file's own zone, and the project as the collection. What is not, and
 * is said: sections (tasks kept, the heading dropped), sub-task nesting (kept
 * as tasks at the top level), recurrence (the date is kept, the rule is not),
 * and a date the parser could not read (the task is kept, undated).
 */

import { asInstant } from '../schedule';
import type { ImportPlan, ImportedTask } from '../importing';

import { column, hasColumns, parseCsv } from './csv';

/** Todoist's 1–4, where 4 is the most urgent, onto the fixed scale. */
const PRIORITY: Record<string, string> = { '4': 'urgent', '3': 'high', '2': 'medium' };

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Does this text look like a Todoist template export? */
export function looksLikeTodoist(text: string): boolean {
  const { header } = parseCsv(text.slice(0, 4096));
  return hasColumns(header, 'TYPE', 'CONTENT', 'PRIORITY', 'INDENT');
}

/**
 * The plan for a Todoist project.
 *
 * `projectName` is the collection the tasks land in — the file's own name,
 * since the file does not say. `zone` is used only when a row has no
 * TIMEZONE of its own.
 */
export function fromTodoist(text: string, projectName: string, zone: string): ImportPlan | null {
  const table = parseCsv(text);
  if (!hasColumns(table.header, 'TYPE', 'CONTENT')) return null;

  const collection = projectName.trim() === '' ? 'Todoist' : projectName.trim();
  const tasks: ImportedTask[] = [];
  const warnings: string[] = [...table.problems];
  let sections = 0;
  let nested = 0;
  let recurring = 0;
  const unreadable: string[] = [];
  let orphanNotes = 0;

  table.rows.forEach((row, index) => {
    const type = column(row, 'TYPE').toLowerCase();
    const content = column(row, 'CONTENT');
    if (type === 'section') {
      sections += 1;
      return;
    }
    if (type === 'note') {
      const last = tasks.at(-1);
      if (last === undefined) {
        orphanNotes += 1;
        return;
      }
      last.notes =
        [last.notes, content].filter((part) => part && part.trim() !== '').join('\n\n') || null;
      return;
    }
    if (type !== 'task' || content.trim() === '') return;

    const indent = Number(column(row, 'INDENT') || '1');
    if (indent > 1) nested += 1;

    const dateText = column(row, 'DATE');
    const rowZone = column(row, 'TIMEZONE') || zone;
    let dueAt: string | null = null;
    if (dateText !== '') {
      if (/\bevery\b|\bdaily\b|\bweekly\b|\bmonthly\b|\byearly\b/i.test(dateText)) recurring += 1;
      dueAt = readTodoistDate(dateText, rowZone);
      if (dueAt === null) unreadable.push(`row ${index + 2} (“${dateText}”)`);
    }

    const description = column(row, 'DESCRIPTION');
    tasks.push({
      key: `todoist:${index + 2}`,
      collection,
      title: content.trim(),
      notes: description.trim() === '' ? null : description.trim(),
      startAt: null,
      dueAt,
      completedAt: null,
      estimateMinutes: readDuration(column(row, 'DURATION'), column(row, 'DURATION_UNIT')),
      isMilestone: false,
      values: PRIORITY[column(row, 'PRIORITY')]
        ? { Priority: PRIORITY[column(row, 'PRIORITY')] }
        : {},
    });
  });

  if (sections > 0) {
    warnings.push(
      `${sections} ${sections === 1 ? 'section heading was' : 'section headings were'} left out; the tasks under ${sections === 1 ? 'it' : 'them'} were kept.`,
    );
  }
  if (nested > 0) {
    warnings.push(
      `${nested} ${nested === 1 ? 'sub-task was' : 'sub-tasks were'} imported as ${nested === 1 ? 'a task' : 'tasks'} at the top level; nesting is not carried.`,
    );
  }
  if (recurring > 0) {
    warnings.push(
      `${recurring} ${recurring === 1 ? 'task repeats' : 'tasks repeat'} in Todoist; the next date was kept, the rule was not.`,
    );
  }
  if (unreadable.length > 0) {
    warnings.push(
      `${unreadable.length} ${unreadable.length === 1 ? 'date was' : 'dates were'} not understood and ${unreadable.length === 1 ? 'the task is' : 'the tasks are'} undated: ${unreadable.slice(0, 5).join(', ')}${unreadable.length > 5 ? ', …' : ''}.`,
    );
  }
  if (orphanNotes > 0) {
    warnings.push(
      `${orphanNotes} ${orphanNotes === 1 ? 'note' : 'notes'} came before any task and ${orphanNotes === 1 ? 'was' : 'were'} left out.`,
    );
  }

  return {
    source: `a Todoist export (${collection})`,
    collections: [{ name: collection, icon: null, color: null }],
    tasks,
    events: [],
    warnings,
  };
}

/**
 * A Todoist date as typed: `Sep 10 2026 14:00`, `10 Sep 2026`, `2026-09-10`,
 * `2026-09-10T14:00:00`, or a recurring phrase whose next date Todoist did
 * not write down. The wall clock is read in the row's zone; a date with no
 * time is due at the end of that day, the way the product's own grammar has it.
 */
export function readTodoistDate(text: string, zone: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (iso) {
    return wallClock(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), iso[4], iso[5], zone);
  }

  // `Sep 10 2026 14:00`, `Sep 10, 2026`, `10 Sep 2026 14:00`, `10 Sep 2026`.
  const monthFirst = trimmed.match(
    /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/,
  );
  const dayFirst = trimmed.match(
    /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/,
  );
  const parts = monthFirst
    ? {
        month: monthFirst[1]!,
        day: monthFirst[2]!,
        year: monthFirst[3]!,
        hour: monthFirst[4],
        minute: monthFirst[5],
      }
    : dayFirst
      ? {
          month: dayFirst[2]!,
          day: dayFirst[1]!,
          year: dayFirst[3]!,
          hour: dayFirst[4],
          minute: dayFirst[5],
        }
      : null;
  if (parts === null) return null;
  const month =
    MONTHS[parts.month.slice(0, 4).toLowerCase()] ?? MONTHS[parts.month.slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  return wallClock(Number(parts.year), month, Number(parts.day), parts.hour, parts.minute, zone);
}

function wallClock(
  year: number,
  month: number,
  day: number,
  hour: string | undefined,
  minute: string | undefined,
  zone: string,
): string | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const wall = new Date(0);
  wall.setFullYear(year, month, day);
  if (hour !== undefined && minute !== undefined) {
    wall.setHours(Number(hour), Number(minute), 0, 0);
  } else {
    wall.setHours(23, 59, 0, 0);
  }
  if (Number.isNaN(wall.getTime()) || wall.getDate() !== day) return null;
  try {
    return asInstant(wall, zone);
  } catch {
    return null;
  }
}

/** Todoist's DURATION and DURATION_UNIT (`minute` or `day`) as minutes of work. */
function readDuration(amount: string, unit: string): number | null {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (unit.toLowerCase().startsWith('day')) return value * 8 * 60;
  return value;
}
