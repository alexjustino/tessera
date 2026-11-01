/**
 * The week mosaic (M4): one tile per working hour, and a sentence whose
 * numbers agree with the tiles.
 *
 * A _tessera_ is one tile of a mosaic. Here each tile is an hour of the
 * working week, and what is on it says where that hour went or is going:
 *
 * - **reserved** — the calendar already spent it (an event, or time blocked
 *   for a task);
 * - **committed** — the projection of ADR-034 puts estimated work in it;
 * - **lived** — time was tracked in it;
 * - **past** — it has gone by with nothing tracked;
 * - **free** — nothing claims it yet.
 *
 * Above the grid, four figures that carry their rows (ADR-024): the tiles the
 * week has, the hours the calendar took, the hours the work due by the end of
 * the week still needs, and the hours left to do it in. When the work needs
 * more than is left, the difference is drawn as tiles too — the week is short
 * before it starts, which no list will ever tell you.
 *
 * **Minutes underneath, tiles on top** (SPEC 1.3). Every number is minutes;
 * a tile is a drawing of up to sixty of them. A tile takes the state that
 * holds most of its minutes, and where a working day does not end on the hour
 * its last tile is shorter and says so.
 *
 * **Committed is not reserved** (ADR-023, ADR-034): the two are different
 * states and never the same colour; a reserved hour is never also committed.
 *
 * **Today.** The projection counts today as a whole day (ADR-034's stated
 * cost). The mosaic does not pretend the hours already gone are still free:
 * today's committed work is laid on the hours still ahead, and what does not
 * fit there is counted as short and said in words.
 */

import { workingSpan, minutesInto, type Occurrence, type WorkHours } from './calendar';
import type { Goal, GoalLink } from './goal';
import type { Item } from './item';
import type { Projection } from './receipt';
import { counted, summed, type Figure, type ReportRow } from './report';
import { localDay, localPlace } from './schedule';
import type { Entry } from './time';

export type TileState = 'free' | 'reserved' | 'committed' | 'lived' | 'past';

export const TILE_STATES: ReadonlyArray<{ id: TileState; label: string }> = [
  { id: 'free', label: 'Free' },
  { id: 'reserved', label: 'Reserved on the calendar' },
  { id: 'committed', label: 'Committed to estimated work' },
  { id: 'lived', label: 'Time tracked' },
  { id: 'past', label: 'Gone, nothing tracked' },
];

export interface Tile {
  day: string;
  /** Minutes from local midnight. */
  startMinute: number;
  /** Sixty, or fewer for a day that does not end on the hour. */
  minutes: number;
  state: TileState;
  /** What the tile is for: the event's title or the task's. */
  label: string | null;
  itemId: string | null;
  /** The tile the present moment is in. */
  current: boolean;
  /**
   * A past tile that time was set aside in for a task (M6): what was planned,
   * what was lived, and whether the two halves close into one.
   */
  split: Split | null;
}

/** The split tile (M6): plan above, life below. */
export interface Split {
  planItemId: string;
  planLabel: string;
  /** The task tracked in this hour, or null when nothing was. */
  livedItemId: string | null;
  livedLabel: string | null;
  /** True when life matched the plan: the tile is whole. */
  closed: boolean;
}

export interface MosaicDay {
  day: string;
  /** A day off, or a day outside the working week. */
  off: boolean;
  tiles: Tile[];
}

export interface Mosaic {
  days: MosaicDay[];
  /** The earliest start and latest end across the week, for laying out rows. */
  firstMinute: number;
  lastMinute: number;
  tileCount: number;
  /** Tiles per state, not counting split tiles — those are counted in `splits`. */
  counts: Record<TileState, number>;
  /** Split tiles (M6) as drawn: whole (closed) and split (open). */
  splits: { closed: number; open: number };
  /** Tiles' worth of work that the week cannot hold. */
  shortTiles: number;
  /** Minutes the projection put on today that do not fit in what is left of it. */
  todayOverflow: number;
  /** True when some tile is shorter than an hour. */
  rounded: boolean;
  capacity: Figure;
  reserved: Figure;
  needs: Figure;
  available: Figure;
  /** Past tiles with time set aside for a task, and the ones whose life matched (M6). */
  planned: Figure;
  closed: Figure;
  /** The planned tiles that did not close — what the week's figure opens onto. */
  open: Figure;
}

export interface MosaicInput {
  week: readonly string[];
  now: string;
  zone: string;
  hours: readonly WorkHours[];
  daysOff?: ReadonlySet<string>;
  occurrences: readonly Occurrence[];
  entries: readonly Entry[];
  items: readonly Item[];
  projection: Projection;
}

const HOUR = 60;

/** Minutes of `[from, to)` that fall inside `[start, end)`. */
function overlap(from: number, to: number, start: number, end: number): number {
  return Math.max(0, Math.min(to, end) - Math.max(from, start));
}

export function mosaicOf(input: MosaicInput): Mosaic {
  const { now, zone } = input;
  const daysOff = input.daysOff ?? new Set<string>();
  const here = localPlace(now, zone);
  const titles = new Map(input.items.map((item) => [item.id, item.title]));
  const weekEnd = input.week.at(-1) ?? here.day;

  const days: MosaicDay[] = [];
  const plannedRows: ReportRow[] = [];
  const closedRows: ReportRow[] = [];
  const openRows: ReportRow[] = [];
  const capacityRows: ReportRow[] = [];
  const reservedRows = new Map<string, ReportRow>();
  const availableRows: ReportRow[] = [];
  let firstMinute = Number.POSITIVE_INFINITY;
  let lastMinute = 0;
  let todayOverflow = 0;
  let rounded = false;

  for (const day of input.week) {
    const span = daysOff.has(day) ? null : workingSpan(day, input.hours);
    if (span === null) {
      days.push({ day, off: true, tiles: [] });
      continue;
    }
    firstMinute = Math.min(firstMinute, span.startsMinute);
    lastMinute = Math.max(lastMinute, span.endsMinute);
    capacityRows.push({
      key: `day:${day}`,
      itemId: null,
      title: 'Working hours',
      day,
      minutes: span.endsMinute - span.startsMinute,
    });

    const onDay = input.occurrences
      .filter((o) => !o.event.allDay)
      .map((o) => ({
        occurrence: o,
        from: minutesInto(o.startsAt, day, zone),
        to: minutesInto(o.endsAt, day, zone),
      }))
      .filter((o) => o.to > o.from);
    const lived = input.entries
      .map((entry) => ({
        entry,
        from: minutesInto(entry.startedAt, day, zone),
        to: minutesInto(entry.endedAt ?? now, day, zone),
      }))
      .filter((e) => e.to > e.from);

    // Today's committed work, in the order the projection claimed it.
    const queue = (input.projection.allocations.get(day) ?? []).map((a) => ({ ...a }));

    const tiles: Tile[] = [];
    let available = 0;
    for (let start = span.startsMinute; start < span.endsMinute; start += HOUR) {
      const minutes = Math.min(HOUR, span.endsMinute - start);
      if (minutes < HOUR) rounded = true;
      const end = start + minutes;
      const past = day < here.day || (day === here.day && end <= here.minute);
      const current = day === here.day && start <= here.minute && here.minute < end;

      // The occurrence and the task with the most minutes in this tile.
      let reserved = 0;
      let reservedLabel: string | null = null;
      let reservedItem: string | null = null;
      let reservedBest = 0;
      let blockItem: string | null = null;
      let blockBest = 0;
      for (const o of onDay) {
        const m = overlap(o.from, o.to, start, end);
        if (m === 0) continue;
        reserved += m;
        if (o.occurrence.event.itemId !== null && m > blockBest) {
          blockBest = m;
          blockItem = o.occurrence.event.itemId;
        }
        const key = `occurrence:${o.occurrence.event.id}@${o.occurrence.originalStart}`;
        const row = reservedRows.get(key);
        if (row === undefined) {
          reservedRows.set(key, {
            key,
            itemId: o.occurrence.event.itemId,
            title: o.occurrence.event.title,
            day,
            minutes: m,
          });
        } else {
          row.minutes += m;
        }
        if (m > reservedBest) {
          reservedBest = m;
          reservedLabel = o.occurrence.event.title;
          reservedItem = o.occurrence.event.itemId;
        }
      }
      reserved = Math.min(reserved, minutes);

      let livedMinutes = 0;
      let livedItem: string | null = null;
      let livedBest = 0;
      for (const e of lived) {
        const m = overlap(e.from, e.to, start, end);
        if (m === 0) continue;
        livedMinutes += m;
        if (m > livedBest) {
          livedBest = m;
          livedItem = e.entry.itemId;
        }
      }

      // The split tile (M6): a past hour set aside for a task, read against
      // what was tracked in it.
      const livedEnough = livedMinutes * 2 >= minutes;
      const split: Split | null =
        past && blockItem !== null && blockBest * 2 >= minutes
          ? {
              planItemId: blockItem,
              planLabel: titles.get(blockItem) ?? reservedLabel ?? '',
              livedItemId: livedEnough ? livedItem : null,
              livedLabel: livedEnough ? (titles.get(livedItem ?? '') ?? null) : null,
              closed: livedEnough && livedItem === blockItem,
            }
          : null;
      if (split !== null) {
        const key = `tile:${day}@${start}`;
        plannedRows.push({
          key,
          itemId: split.planItemId,
          title: split.planLabel,
          day,
          minutes: 0,
        });
        if (split.closed) {
          closedRows.push({
            key,
            itemId: split.planItemId,
            title: split.planLabel,
            day,
            minutes: 0,
          });
        } else {
          openRows.push({
            key,
            itemId: split.planItemId,
            title: `${clockOf(start)} planned ${split.planLabel} — ${
              split.livedLabel === null ? 'nothing tracked' : `lived ${split.livedLabel}`
            }`,
            day,
            minutes: 0,
          });
        }
      }

      const base = { day, startMinute: start, minutes, current, split };
      if ((past || current) && livedMinutes * 2 >= minutes) {
        tiles.push({
          ...base,
          state: 'lived',
          label: titles.get(livedItem ?? '') ?? null,
          itemId: livedItem,
        });
        continue;
      }
      if (reserved * 2 >= minutes) {
        tiles.push({ ...base, state: 'reserved', label: reservedLabel, itemId: reservedItem });
        continue;
      }
      if (past) {
        tiles.push({ ...base, state: 'past', label: null, itemId: null });
        continue;
      }

      // Free time in this tile, claimed by the projection's work in order.
      const free = minutes - reserved;
      available += free;
      let claimed = 0;
      let firstItem: string | null = null;
      while (claimed < free && queue.length > 0) {
        const head = queue[0];
        if (head === undefined) break;
        const take = Math.min(free - claimed, head.minutes);
        claimed += take;
        head.minutes -= take;
        firstItem ??= head.itemId;
        if (head.minutes === 0) queue.shift();
      }
      if (claimed * 2 >= free && claimed > 0) {
        tiles.push({
          ...base,
          state: 'committed',
          label: titles.get(firstItem ?? '') ?? null,
          itemId: firstItem,
        });
      } else {
        tiles.push({ ...base, state: 'free', label: null, itemId: null });
      }
    }
    for (const left of queue) todayOverflow += left.minutes;
    if (available > 0) {
      availableRows.push({
        key: `day:${day}`,
        itemId: null,
        title: 'Not yet claimed',
        day,
        minutes: available,
      });
    }
    days.push({ day, off: false, tiles });
  }

  // Work due by the end of the week, still needing time.
  const needsRows: ReportRow[] = [];
  for (const [itemId, minutes] of input.projection.demand) {
    const due = input.projection.dueDays.get(itemId);
    if (due === undefined || due > weekEnd || minutes <= 0) continue;
    needsRows.push({
      key: `task:${itemId}`,
      itemId,
      title: titles.get(itemId) ?? '',
      day: due,
      minutes,
    });
  }
  needsRows.sort(
    (a, b) => (a.day ?? '').localeCompare(b.day ?? '') || a.title.localeCompare(b.title),
  );

  const counts: Record<TileState, number> = {
    free: 0,
    reserved: 0,
    committed: 0,
    lived: 0,
    past: 0,
  };
  let tileCount = 0;
  const splits = { closed: 0, open: 0 };
  for (const day of days) {
    for (const tile of day.tiles) {
      tileCount += 1;
      // A split tile is drawn as plan and life, not as its state, so the
      // legend counts what the grid shows (two readings agree).
      if (tile.split === null) counts[tile.state] += 1;
      else if (tile.split.closed) splits.closed += 1;
      else splits.open += 1;
    }
  }

  const needs = summed('mosaic:needs', 'Due by the end of the week', needsRows);
  const availableFigure = summed('mosaic:available', 'Left to do it in', availableRows);
  // Today's overflow is already inside this difference — its work is in the
  // needs, and the hours it did not fit are not in what is left — so it is
  // said, never added a second time.
  const short = Math.max(0, needs.value - availableFigure.value);

  return {
    days,
    firstMinute: Number.isFinite(firstMinute) ? firstMinute : 0,
    lastMinute,
    tileCount,
    counts,
    splits,
    shortTiles: Math.ceil(short / HOUR),
    todayOverflow,
    rounded,
    capacity: summed('mosaic:capacity', 'Working hours this week', capacityRows),
    reserved: summed('mosaic:reserved', 'Reserved on the calendar', [...reservedRows.values()]),
    needs,
    available: availableFigure,
    planned: counted('mosaic:planned', 'Hours set aside for a task', plannedRows),
    closed: counted('mosaic:closed', 'Closed — life matched the plan', closedRows),
    open: counted('mosaic:open', 'Did not close', openRows),
  };
}

/** `09:00` for minutes from midnight. */
function clockOf(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** Whether a week (as its first day) is wholly before today. */
export function isPastWeek(week: readonly string[], now: string, zone: string): boolean {
  const last = week.at(-1);
  return last !== undefined && last < localDay(now, zone);
}

// ── Envelopes (M5) ─────────────────────────────────────────────────────────

/** One goal's weekly budget, and what this week's tiles spend of it. */
export interface Envelope {
  goalId: string;
  name: string;
  /** Minutes a week the goal holds. */
  budget: number;
  /** Committed and lived minutes on the goal's tasks this week, by task. */
  used: Figure;
  committed: number;
  lived: number;
  /** Minutes past the budget — recorded, never refused. */
  over: number;
}

export interface Envelopes {
  envelopes: Envelope[];
  /** Minutes all envelopes hold together. */
  budgeted: number;
  /** Open minutes (capacity less reserved) promised to no envelope. */
  margin: number;
  /** Minutes the envelopes promise beyond the open week. */
  overPromised: number;
}

/**
 * Every tile has a destination (SPEC 1.3): the calendar's, an envelope's, or
 * the margin. An envelope's spend is read from the tiles themselves — the
 * committed and lived ones on its tasks — so the number beside an envelope is
 * always the tiles a person can count on the grid (ADR-037). A task in two
 * goals spends in both, and the screen says so.
 */
export function envelopesOf(
  mosaic: Mosaic,
  goals: readonly Goal[],
  goalLinks: readonly GoalLink[],
): Envelopes {
  const tiles = mosaic.days.flatMap((day) => day.tiles);
  const envelopes: Envelope[] = [];
  for (const goal of goals) {
    const budget = goal.weeklyMinutes ?? 0;
    if (budget <= 0) continue;
    const mine = new Set(goalLinks.filter((l) => l.goalId === goal.id).map((l) => l.itemId));
    const byTask = new Map<string, ReportRow>();
    let committed = 0;
    let lived = 0;
    for (const tile of tiles) {
      if (tile.itemId === null || !mine.has(tile.itemId)) continue;
      if (tile.state !== 'committed' && tile.state !== 'lived') continue;
      if (tile.state === 'committed') committed += tile.minutes;
      else lived += tile.minutes;
      const key = `task:${tile.itemId}`;
      const row = byTask.get(key);
      if (row === undefined) {
        byTask.set(key, {
          key,
          itemId: tile.itemId,
          title: tile.label ?? '',
          day: null,
          minutes: tile.minutes,
        });
      } else {
        row.minutes += tile.minutes;
      }
    }
    const used = summed(`envelope:${goal.id}`, goal.name, [...byTask.values()]);
    envelopes.push({
      goalId: goal.id,
      name: goal.name,
      budget,
      used,
      committed,
      lived,
      over: Math.max(0, used.value - budget),
    });
  }
  const budgeted = envelopes.reduce((sum, e) => sum + e.budget, 0);
  const open = mosaic.capacity.value - mosaic.reserved.value;
  return {
    envelopes,
    budgeted,
    margin: Math.max(0, open - budgeted),
    overPromised: Math.max(0, budgeted - open),
  };
}
