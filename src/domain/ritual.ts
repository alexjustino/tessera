/**
 * The daily ritual (ADR-061): plan the day in the morning, close it at night.
 *
 * Tessera already holds every piece a day needs: what is due, what is late, the free
 * time, the suggested plan, the clock and the score. The ritual puts them in an order a
 * person walks through in a minute. In the morning: what was left from before goes to
 * today, to tomorrow, or is done; today is weighed against the free time it has; and
 * its work goes on the calendar. At night: what got done, what did not and goes to
 * tomorrow, and a line about the day, which Notes keeps in a journal.
 *
 * Moving work to a day keeps its time of day, and a reminder moves by as much as its
 * date, as replanning does (ADR-052); a repeating task is left alone, because its date
 * moves the series. The writes go through the same atomic command.
 *
 * Pure: no I/O, no React, no host.
 */

import { ASSUMED_MINUTES } from './autoPlan';
import type { DocNode } from './document';
import type { Item } from './item';
import { instantOf } from './moveByKeys';
import { localPlace } from './schedule';

/** Where a task with no time of day lands: the end of the day, as a typed date does. */
const END_OF_DAY = 23 * 60 + 59;

export interface DayMove {
  itemId: string;
  dueAt: string;
  remindAt: string | null;
  blocks: [];
}

/** A task's date on another day: the same time of day, or the day's end. */
export function dateOn(item: Item, day: string, zone: string, now: string): DayMove {
  const minute = item.dueAt === null ? END_OF_DAY : localPlace(item.dueAt, zone).minute;
  let dueAt = instantOf(day, minute, zone);
  // Kept for today, a time of day already gone would make it late again at once.
  if (Date.parse(dueAt) <= Date.parse(now)) dueAt = instantOf(day, END_OF_DAY, zone);
  const shift = item.dueAt === null ? 0 : Date.parse(dueAt) - Date.parse(item.dueAt);
  const remindAt =
    item.remindAt === null ? null : new Date(Date.parse(item.remindAt) + shift).toISOString();
  return { itemId: item.id, dueAt, remindAt, blocks: [] };
}

/** Which of these can move to a day, and which are left because they repeat. */
export function movesTo(
  items: readonly Item[],
  day: string,
  zone: string,
  now: string,
): { moves: DayMove[]; repeating: Item[] } {
  return {
    moves: items
      .filter((item) => item.recurrenceRule === null)
      .map((item) => dateOn(item, day, zone, now)),
    repeating: items.filter((item) => item.recurrenceRule !== null),
  };
}

/** The work these tasks still need, in minutes: what is left of each estimate, or an hour. */
export function workLeft(items: readonly Item[], tracked: ReadonlyMap<string, number>): number {
  return items.reduce((sum, item) => {
    if (item.isMilestone) return sum;
    if (item.estimateMinutes === null) return sum + ASSUMED_MINUTES;
    return sum + Math.max(0, item.estimateMinutes - (tracked.get(item.id) ?? 0));
  }, 0);
}

/** How many of the tasks had no estimate, so an hour was assumed for them. */
export function assumedIn(items: readonly Item[]): number {
  return items.filter((item) => !item.isMilestone && item.estimateMinutes === null).length;
}

/** Whether the work fits the free time, and by how much it does not. */
export function weigh(work: number, free: number): { fits: boolean; overBy: number } {
  return { fits: work <= free, overBy: Math.max(0, work - free) };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** One journal page a month, in the Journal section of Notes. */
export function journalTitle(day: string): string {
  const [year, month] = day.split('-').map(Number);
  return `Journal — ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

export const JOURNAL_SECTION = 'Journal';

function dayWords(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function hours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** What a closed day adds to its journal page: the day, its figures, and the line. */
export function journalEntry(
  day: string,
  figures: { done: number; tracked: number; score: number | null; carried: number },
  note: string,
): DocNode[] {
  const parts = [
    `${figures.done} done`,
    `${hours(figures.tracked)} on the clock`,
    ...(figures.carried > 0 ? [`${figures.carried} to tomorrow`] : []),
    ...(figures.score === null ? [] : [`score ${figures.score}`]),
  ];
  const nodes: DocNode[] = [
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: dayWords(day) }] },
    { type: 'paragraph', content: [{ type: 'text', text: parts.join(' · ') }] },
  ];
  const line = note.trim();
  if (line !== '') nodes.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
  return nodes;
}

/** When the day's cards are offered: planning until mid-afternoon, closing from then. */
export function ritualDue(
  minuteNow: number,
  record: { plannedAt: string | null; closedAt: string | null } | null,
): 'plan' | 'close' | null {
  if (record?.closedAt) return null;
  if (minuteNow < 15 * 60) return record?.plannedAt ? null : 'plan';
  return minuteNow >= 16 * 60 ? 'close' : null;
}
