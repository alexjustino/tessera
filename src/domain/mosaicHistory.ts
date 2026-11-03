/**
 * The weeks behind this one, one small tile per day, and what tells goals apart.
 *
 * The week says where this week's hours are going. This says whether that is
 * usual: how much of each working day had a clock running, for the last three
 * months. Shades are one hue, from nothing to most of the day, in four steps a
 * person can name. Pure: no I/O, no React, no host.
 */

import { addLocalDays, type WorkHours } from './calendar';
import { capacityOf } from './capacity';
import type { Goal, GoalLink } from './goal';
import { minutesByDay, type Entry } from './time';

/** How many goals get a colour of their own. The rest share none rather than a seventh hue. */
export const SERIES = 6;

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export const HEAT_WORDS: Record<HeatLevel, string> = {
  0: 'Nothing tracked',
  1: 'Up to a quarter of the day',
  2: 'Up to half',
  3: 'Up to three quarters',
  4: 'Most of the day',
};

export interface HistoryDay {
  day: string;
  capacity: number;
  tracked: number;
  level: HeatLevel;
  /** A day with no working hours and nothing tracked: nothing to draw. */
  hole: boolean;
  /** After today: it has not happened. */
  future: boolean;
}

export interface HistoryWeek {
  firstDay: string;
  days: HistoryDay[];
  tracked: number;
  capacity: number;
}

function levelOf(tracked: number, capacity: number): HeatLevel {
  if (tracked <= 0) return 0;
  // A Saturday someone worked has no capacity to measure against: it was a day's work.
  const share = capacity > 0 ? tracked / capacity : 1;
  if (share <= 0.25) return 1;
  if (share <= 0.5) return 2;
  if (share <= 0.75) return 3;
  return 4;
}

/** The weeks up to and including the one that starts on `firstDay`, oldest first. */
export function historyOf(input: {
  firstDay: string;
  today: string;
  weeks: number;
  entries: readonly Entry[];
  hours: readonly WorkHours[];
  daysOff?: ReadonlySet<string>;
  zone: string;
  now: string;
}): HistoryWeek[] {
  const tracked = new Map(
    minutesByDay(input.entries, input.zone, input.now).map((share) => [share.day, share.minutes]),
  );
  const weeks: HistoryWeek[] = [];
  for (let back = input.weeks - 1; back >= 0; back -= 1) {
    const firstDay = addLocalDays(input.firstDay, -7 * back);
    const days = Array.from({ length: 7 }, (_, offset): HistoryDay => {
      const day = addLocalDays(firstDay, offset);
      const capacity = capacityOf(day, input.hours, input.daysOff);
      const minutes = tracked.get(day) ?? 0;
      return {
        day,
        capacity,
        tracked: minutes,
        level: levelOf(minutes, capacity),
        hole: capacity === 0 && minutes === 0,
        future: day > input.today,
      };
    });
    weeks.push({
      firstDay,
      days,
      tracked: days.reduce((sum, day) => sum + day.tracked, 0),
      capacity: days.reduce((sum, day) => sum + day.capacity, 0),
    });
  }
  return weeks;
}

/**
 * Which colour each goal wears, in the goals' own order, so a goal keeps its
 * colour whatever is on screen. A seventh goal gets none: past six, hues stop
 * being tellable apart, and it still has its name and its mark.
 */
export function seriesOf(goals: readonly Goal[]): Map<string, number> {
  return new Map(goals.slice(0, SERIES).map((goal, index) => [goal.id, index + 1]));
}

/** The goals a task counts towards, in the goals' own order. */
export function goalsOfItem(
  itemId: string,
  goals: readonly Goal[],
  links: readonly GoalLink[],
): Goal[] {
  const mine = new Set(links.filter((link) => link.itemId === itemId).map((link) => link.goalId));
  return goals.filter((goal) => mine.has(goal.id));
}
