/**
 * What to do now: one answer, from what the workspace already knows.
 *
 * Every screen in the product says something about the day. None said the one thing
 * a person asks when they sit down. The rule is short, so it can be argued with:
 *
 * 1. a clock that is running: that is what you are doing;
 * 2. time reserved for a task right now: that is what you said you would do;
 * 3. an event right now: you are in it, and there is nothing to start;
 * 4. what comes next, whichever is sooner of what is reserved and what the plan
 *    suggests (ADR-046).
 *
 * It closes the loop the product is built on: the calendar says when, the clock says
 * what happened, and the Mosaic can tell whether the two matched. Pure: no I/O, no
 * React, no host.
 */

import type { Occurrence } from './calendar';
import type { Suggestion } from './autoPlan';
import type { Item } from './item';
import type { Entry } from './time';

export type NowPick =
  | { kind: 'running'; itemId: string; title: string; startedAt: string }
  | { kind: 'reserved'; itemId: string; title: string; endsAt: string }
  | { kind: 'event'; title: string; endsAt: string }
  | { kind: 'next'; itemId: string | null; title: string; startsAt: string }
  | { kind: 'suggested'; suggestion: Suggestion };

export function pickNow(input: {
  now: string;
  entries: readonly Entry[];
  items: readonly Item[];
  /** Occurrences covering at least today. */
  occurrences: readonly Occurrence[];
  /** The suggested plan, soonest first. */
  suggestions: readonly Suggestion[];
}): NowPick | null {
  const { now, entries, items, occurrences, suggestions } = input;
  const at = Date.parse(now);
  const titleOf = (id: string) => items.find((item) => item.id === id)?.title ?? 'A task';
  const isOpen = (id: string) => items.some((item) => item.id === id && item.completedAt === null);

  const running = entries.find((entry) => entry.endedAt === null);
  if (running !== undefined) {
    return {
      kind: 'running',
      itemId: running.itemId,
      title: titleOf(running.itemId),
      startedAt: running.startedAt,
    };
  }

  const timed = occurrences
    .filter((occurrence) => !occurrence.event.allDay)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const during = timed.filter(
    (occurrence) => Date.parse(occurrence.startsAt) <= at && Date.parse(occurrence.endsAt) > at,
  );

  // Two things at once: the work is what can be started.
  const block = during.find(
    (occurrence) => occurrence.event.itemId !== null && isOpen(occurrence.event.itemId),
  );
  if (block !== undefined && block.event.itemId !== null) {
    return {
      kind: 'reserved',
      itemId: block.event.itemId,
      title: titleOf(block.event.itemId),
      endsAt: block.endsAt,
    };
  }
  const event = during.find((occurrence) => occurrence.event.itemId === null);
  if (event !== undefined) {
    return { kind: 'event', title: event.event.title || 'Untitled', endsAt: event.endsAt };
  }

  const coming = timed.find(
    (occurrence) =>
      Date.parse(occurrence.startsAt) > at &&
      (occurrence.event.itemId === null || isOpen(occurrence.event.itemId)),
  );
  const suggested = suggestions[0];
  if (
    suggested !== undefined &&
    (coming === undefined || Date.parse(suggested.startsAt) < Date.parse(coming.startsAt))
  ) {
    return { kind: 'suggested', suggestion: suggested };
  }
  if (coming !== undefined) {
    return {
      kind: 'next',
      itemId: coming.event.itemId,
      title:
        coming.event.itemId === null
          ? coming.event.title || 'Untitled'
          : titleOf(coming.event.itemId),
      startsAt: coming.startsAt,
    };
  }
  return null;
}
