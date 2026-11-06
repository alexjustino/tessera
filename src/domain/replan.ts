/**
 * Replan in one press: every late task moved to the next free time, the date with it
 * (ADR-052).
 *
 * A week slips. What was due on Tuesday is still open on Thursday, and putting it right
 * by hand is a date and a reservation per task. This works out, before anything is
 * written, what one press would do: each late task gets blocks in the free working time
 * from now on, late work first and in the order the plan already uses, and its date
 * moves to the day the last block ends. The person sees the list, presses once, and can
 * undo it in one press too.
 *
 * **What it leaves alone, and says.** A repeating task: moving its date moves the whole
 * series, which is a different decision. A task waiting on open work that is not late:
 * planning it first would put it before what it waits on. A task with no room in the
 * plan's horizon: it is listed, unchanged, rather than given a date nothing supports.
 *
 * **What it keeps.** The time of day a date was set for, when the new day still allows
 * it; a reminder, moved by the same amount as its date, so it rings as far ahead as it
 * did. A late task that already has time reserved ahead gets no new block, only the date
 * of its last one.
 *
 * Pure: no I/O, no React, no host. The same input always gives the same answer.
 */

import { suggestPlan } from './autoPlan';
import type { Item } from './item';
import { instantOf } from './moveByKeys';
import type { LedgerInput } from './receipt';
import { localPlace } from './schedule';

/** Less than this is not worth a block of its own. */
const SHORTEST = 30;

export interface ReplanBlock {
  startsAt: string;
  endsAt: string;
}

export interface ReplanChange {
  itemId: string;
  title: string;
  previousDueAt: string;
  dueAt: string;
  previousRemindAt: string | null;
  remindAt: string | null;
  /** The local day the new date falls on, for the words. */
  day: string;
  /** New blocks to reserve. Empty when the task already has time set aside ahead. */
  blocks: ReplanBlock[];
  /** The task has no estimate, so the length of its block is an assumption. */
  assumed: boolean;
  /** Only part of what it needs found room. */
  short: boolean;
}

export interface Left {
  itemId: string;
  title: string;
}

export interface Replan {
  changes: ReplanChange[];
  /** Late, and no free time in the horizon holds any of it. */
  noRoom: Left[];
  /** Late, and repeating: moving the date would move the series. */
  repeating: Left[];
  /** Late, and waiting on open work that is not late. */
  waiting: Left[];
}

/** Open work whose date has gone. A milestone is a date, not work, and is not moved. */
export function lateTasks(items: readonly Item[], now: string): Item[] {
  const moment = Date.parse(now);
  return items.filter(
    (item) =>
      item.completedAt === null &&
      !item.isMilestone &&
      item.dueAt !== null &&
      Date.parse(item.dueAt) < moment,
  );
}

const left = (item: Item): Left => ({ itemId: item.id, title: item.title });

/** Work out what one press would do. Nothing is written by asking. */
export function planReplan(input: LedgerInput, now: string): Replan {
  const moment = Date.parse(now);
  const late = lateTasks(input.items, now);
  const repeating = late.filter((item) => item.recurrenceRule !== null);

  // A task waiting on open work that is not itself being replanned stays where it is,
  // and so does whatever waits on it in turn.
  const open = new Set(input.items.filter((item) => item.completedAt === null).map((i) => i.id));
  let candidates = late.filter((item) => item.recurrenceRule === null);
  for (;;) {
    const ids = new Set(candidates.map((item) => item.id));
    const next = candidates.filter((item) =>
      input.edges.every(
        (edge) =>
          edge.blockedId !== item.id || !open.has(edge.blockerId) || ids.has(edge.blockerId),
      ),
    );
    if (next.length === candidates.length) break;
    candidates = next;
  }
  const kept = new Set(candidates.map((item) => item.id));
  const waiting = late.filter((item) => item.recurrenceRule === null && !kept.has(item.id));

  // Time already reserved ahead, per task: where its last block ends.
  const lastBlock = new Map<string, string>();
  for (const occurrence of input.occurrences) {
    const itemId = occurrence.event.itemId;
    if (itemId === null || occurrence.event.allDay) continue;
    if (Date.parse(occurrence.endsAt) <= moment) continue;
    const before = lastBlock.get(itemId);
    if (before === undefined || Date.parse(occurrence.endsAt) > Date.parse(before)) {
      lastBlock.set(itemId, occurrence.endsAt);
    }
  }

  const changes: ReplanChange[] = [];
  const toPlace = candidates.filter((item) => !lastBlock.has(item.id));

  for (const item of candidates) {
    const end = lastBlock.get(item.id);
    if (end !== undefined) changes.push(moved(item, end, [], false, false, input.zone));
  }

  // What each late task still needs, as an estimate the planner can read: what is left
  // of the one typed, never less than a block's worth, or the planner's own assumption.
  const placing = new Set(toPlace.map((item) => item.id));
  const items = input.items.map((item) => {
    if (!placing.has(item.id) || item.estimateMinutes === null) return item;
    const rest = item.estimateMinutes - (input.tracked.get(item.id) ?? 0);
    return { ...item, estimateMinutes: Math.max(SHORTEST, rest) };
  });
  const tracked = new Map(input.tracked);
  for (const id of placing) tracked.delete(id);

  const plan = suggestPlan(
    {
      ...input,
      items,
      tracked,
      // What has ended is not busy any more, and must not count as time set aside.
      occurrences: input.occurrences.filter((o) => Date.parse(o.endsAt) > moment),
    },
    {
      leaveOut: new Set(input.items.filter((i) => !placing.has(i.id)).map((i) => i.id)),
    },
  );

  const noRoom: Left[] = [];
  for (const item of toPlace) {
    const pieces = plan.suggestions.filter((piece) => piece.itemId === item.id);
    const last = pieces.at(-1);
    if (last === undefined) {
      noRoom.push(left(item));
      continue;
    }
    changes.push(
      moved(
        item,
        last.endsAt,
        pieces.map((piece) => ({ startsAt: piece.startsAt, endsAt: piece.endsAt })),
        pieces[0]?.assumed ?? false,
        plan.unplaced.some((short) => short.itemId === item.id),
        input.zone,
      ),
    );
  }

  // In the order the time comes: the first block, or the date for a task that has none.
  const firstOf = (change: ReplanChange) => Date.parse(change.blocks[0]?.startsAt ?? change.dueAt);
  changes.sort((a, b) => firstOf(a) - firstOf(b) || (a.itemId < b.itemId ? -1 : 1));
  return { changes, noRoom, repeating: repeating.map(left), waiting: waiting.map(left) };
}

/**
 * The task's new date: the day its last block ends, at the time of day the date was
 * set for when that is still after the block, or else when the block ends.
 */
function moved(
  item: Item,
  lastEnd: string,
  blocks: ReplanBlock[],
  assumed: boolean,
  short: boolean,
  zone: string,
): ReplanChange {
  const previousDueAt = item.dueAt ?? lastEnd;
  const end = localPlace(lastEnd, zone);
  const wanted = localPlace(previousDueAt, zone).minute;
  const dueAt = instantOf(end.day, Math.max(wanted, end.minute), zone);
  const shift = Date.parse(dueAt) - Date.parse(previousDueAt);
  const remindAt =
    item.remindAt === null ? null : new Date(Date.parse(item.remindAt) + shift).toISOString();
  return {
    itemId: item.id,
    title: item.title,
    previousDueAt,
    dueAt,
    previousRemindAt: item.remindAt,
    remindAt,
    day: end.day,
    blocks,
    assumed,
    short,
  };
}
