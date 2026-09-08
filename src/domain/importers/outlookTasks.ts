/**
 * Microsoft To Do, by way of Outlook.
 *
 * To Do has no export of its own. Its lists are Outlook task folders, and
 * Outlook for Windows exports a task folder as CSV (File → Open & Export →
 * Import/Export → Export to a file → Comma Separated Values → Tasks). The
 * columns are Outlook's — `Subject`, `Start Date`, `Due Date`, `Date
 * Completed`, `Complete`, `Notes`, `Priority`, `Status`, `% Complete` and a
 * dozen more — with dates written in the machine's locale.
 *
 * What is carried: subject, notes, start and due dates (end of day, since the
 * export has no time for them), completion with its date, priority High and
 * Low (Normal is Outlook's default on every task and means nothing), and the
 * status onto the seeded Status property. What is not, and is said: reminders
 * (the product has its own), categories, and a date written in a form the
 * reader could not settle.
 */

import type { ImportPlan, ImportedTask } from '../importing';
import { asInstant } from '../schedule';

import { column, hasColumns, parseCsv } from './csv';

const PRIORITY: Record<string, string> = { high: 'high', low: 'low' };

/** Outlook's task status onto the seeded Status options. */
const STATUS: Record<string, string> = {
  'not started': 'todo',
  'in progress': 'doing',
  'waiting on someone else': 'blocked',
  deferred: 'todo',
  completed: 'done',
};

export function looksLikeOutlookTasks(text: string): boolean {
  const { header } = parseCsv(text.slice(0, 4096));
  return hasColumns(header, 'Subject', 'Due Date') && hasColumns(header, 'Complete');
}

/**
 * The plan for one exported task folder.
 *
 * `listName` is the collection: the To Do list the folder was, which the
 * file does not say and the file's name usually does. `zone` is the machine's,
 * since Outlook wrote wall-clock dates without one. Dates are read as
 * month/day/year first (the export's English form); a day above twelve in the
 * first place settles it the other way round.
 */
export function fromOutlookTasks(
  text: string,
  listName: string,
  zone: string,
  now: string,
): ImportPlan | null {
  const table = parseCsv(text);
  if (!hasColumns(table.header, 'Subject')) return null;

  const collection = listName.trim() === '' ? 'To Do' : listName.trim();
  const tasks: ImportedTask[] = [];
  const warnings: string[] = [...table.problems];
  const unreadable: string[] = [];
  let reminders = 0;
  let categories = 0;

  table.rows.forEach((row, index) => {
    const subject = column(row, 'Subject').trim();
    if (subject === '') return;

    const read = (name: string): string | null => {
      const text = column(row, name);
      if (text === '') return null;
      const instant = readOutlookDate(text, '', zone);
      if (instant === null) unreadable.push(`row ${index + 2} (“${text}”)`);
      return instant;
    };
    const dueAt = read('Due Date');
    const startAt = read('Start Date');
    const status = STATUS[column(row, 'Status').toLowerCase()];
    const complete = /^(true|yes|1)$/i.test(column(row, 'Complete')) || status === 'done';
    // A completed task with no completion date is still completed; the import
    // is the best date there is for when that was noticed.
    const completedAt = complete ? (read('Date Completed') ?? dueAt ?? now) : null;

    if (/^(true|yes|1)$/i.test(column(row, 'Reminder On/Off'))) reminders += 1;
    if (column(row, 'Categories') !== '') categories += 1;

    const values: Record<string, unknown> = {};
    const priority = PRIORITY[column(row, 'Priority').toLowerCase()];
    if (priority) values.Priority = priority;
    const statusId = complete ? 'done' : status;
    if (statusId) values.Status = statusId;

    const notes = column(row, 'Notes').trim();
    tasks.push({
      key: `outlook:${index + 2}`,
      collection,
      title: subject,
      notes: notes === '' ? null : notes,
      startAt,
      dueAt,
      completedAt,
      estimateMinutes: readWork(column(row, 'Total Work')),
      isMilestone: false,
      values,
    });
  });

  if (reminders > 0) {
    warnings.push(
      `${reminders} ${reminders === 1 ? 'task had a reminder' : 'tasks had reminders'} in Outlook; set them again here if you still want them.`,
    );
  }
  if (categories > 0) {
    warnings.push(
      `${categories} ${categories === 1 ? 'task had categories' : 'tasks had categories'}; they were left out.`,
    );
  }
  if (unreadable.length > 0) {
    warnings.push(
      `${unreadable.length} ${unreadable.length === 1 ? 'date was' : 'dates were'} not understood and left empty: ${unreadable.slice(0, 5).join(', ')}${unreadable.length > 5 ? ', …' : ''}.`,
    );
  }

  return {
    source: `a Microsoft To Do list (${collection}), exported from Outlook`,
    collections: [{ name: collection, icon: null, color: null }],
    tasks,
    events: [],
    warnings,
  };
}

/**
 * An Outlook date — `9/10/2026`, `10/9/2026` when the day is over twelve,
 * `2026-09-10`, `10.09.2026` — with an optional time such as `9:00:00 AM`.
 * No time means the end of the day.
 */
export function readOutlookDate(text: string, time: string, zone: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  let year: number;
  let month: number;
  let day: number;

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const slashed = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    year = Number(slashed[3]);
    // Month first unless that cannot be; a dotted date is European by habit.
    const dayFirst = first > 12 || trimmed.includes('.');
    month = (dayFirst ? second : first) - 1;
    day = dayFirst ? first : second;
  } else {
    return null;
  }

  const wall = new Date(0);
  wall.setFullYear(year, month, day);
  const clock = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (clock) {
    let hour = Number(clock[1]);
    const meridiem = clock[4]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    wall.setHours(hour, Number(clock[2]), 0, 0);
  } else {
    wall.setHours(23, 59, 0, 0);
  }
  if (Number.isNaN(wall.getTime()) || wall.getDate() !== day || wall.getMonth() !== month)
    return null;
  try {
    return asInstant(wall, zone);
  } catch {
    return null;
  }
}

/** Outlook's `Total Work` — `2 hours`, `30 minutes`, `1 day` — as minutes. */
function readWork(text: string): number | null {
  const match = text.trim().match(/^([\d.]+)\s*(minute|hour|day|week)s?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2]!.toLowerCase();
  const perUnit = unit === 'minute' ? 1 : unit === 'hour' ? 60 : unit === 'day' ? 480 : 2400;
  return Math.round(amount * perUnit);
}
