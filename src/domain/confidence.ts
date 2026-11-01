/**
 * Dates with confidence: a finish day as a range drawn from the person's own
 * estimate error (M2).
 *
 * Every estimate is wrong by some amount, and each person is wrong in their
 * own direction. Tessera already knows how wrong: every finished task with an
 * estimate and tracked time is one measurement — tracked divided by estimated.
 * Those measurements, and nothing else, turn a single projected day into two:
 *
 * - **likely** — the projection with every remaining estimate scaled by the
 *   median of the measurements: as often early as late;
 * - **85 % sure** — scaled by their 85th percentile: in 85 of 100 past tasks,
 *   the work took no more than that.
 *
 * **No percentage without a sample** (SPEC 1.3). Below `MIN_SAMPLE`
 * measurements there is no range at all, only the plain projected day and a
 * sentence saying how much history is missing (ADR-020's spirit, ADR-035).
 *
 * **What it clamps.** A single measurement outside a quarter to four times
 * its estimate is clamped to that band before it counts — a timer left
 * running overnight, or a task closed without its time, must not make every
 * date absurd. The clamp is stated, not hidden.
 */

import { against } from './time';
import type { Item } from './item';
import { project, type LedgerInput } from './receipt';

/** Finished tasks, with an estimate and tracked time, before a range is shown. */
export const MIN_SAMPLE = 10;

/** The band one measurement is clamped to. */
export const RATIO_FLOOR = 0.25;
export const RATIO_CEILING = 4;

export interface Calibration {
  /** How many finished tasks the ratios come from. */
  sample: number;
  /** Median tracked / estimated, or null below the sample. */
  likely: number | null;
  /** 85th percentile, or null below the sample. */
  sure: number | null;
}

/**
 * One ratio per finished task that has an estimate and tracked time, clamped
 * to the band.
 */
export function ratiosOf(items: readonly Item[], tracked: ReadonlyMap<string, number>): number[] {
  const ratios: number[] = [];
  for (const item of items) {
    if (item.completedAt === null || item.isMilestone) continue;
    const minutes = tracked.get(item.id) ?? 0;
    if (minutes <= 0) continue;
    const comparison = against(minutes, item.estimateMinutes);
    if (comparison === null) continue;
    ratios.push(Math.min(RATIO_CEILING, Math.max(RATIO_FLOOR, comparison.ratio)));
  }
  return ratios;
}

/**
 * The q-th quantile of sorted values, interpolated between neighbours (the
 * common "type 7" definition, the one a spreadsheet's PERCENTILE uses).
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) throw new Error('quantile of nothing');
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  const low = sorted[below] ?? 0;
  const high = sorted[above] ?? low;
  return low + (high - low) * (position - below);
}

export function calibrationOf(
  items: readonly Item[],
  tracked: ReadonlyMap<string, number>,
): Calibration {
  const ratios = ratiosOf(items, tracked).sort((a, b) => a - b);
  if (ratios.length < MIN_SAMPLE) return { sample: ratios.length, likely: null, sure: null };
  return {
    sample: ratios.length,
    likely: quantile(ratios, 0.5),
    sure: quantile(ratios, 0.85),
  };
}

/** A finish day, plain and — when there is history enough — as a range. */
export interface Forecast {
  /** On the estimates as typed. Null when it does not fit in the horizon. */
  plain: string | null;
  /** Null below the sample, or when it does not fit. */
  likely: string | null;
  sure: string | null;
}

/**
 * Where one task is projected to finish on the estimates as typed, and — when
 * the calibration has a sample — with every remaining estimate scaled by the
 * median and by the 85th percentile.
 */
export function forecastTask(
  input: LedgerInput,
  calibration: Calibration,
  itemId: string,
): Forecast | null {
  const plain = project(input).finishes;
  if (!plain.has(itemId)) return null;
  if (calibration.likely === null || calibration.sure === null) {
    return { plain: plain.get(itemId) ?? null, likely: null, sure: null };
  }
  return {
    plain: plain.get(itemId) ?? null,
    likely: project({ ...input, scale: calibration.likely }).finishes.get(itemId) ?? null,
    sure: project({ ...input, scale: calibration.sure }).finishes.get(itemId) ?? null,
  };
}

/** A goal's completion: when the last of its projected tasks is done. */
export interface GoalForecast extends Forecast {
  goalId: string;
}

function lastOf(
  finishes: ReadonlyMap<string, string | null>,
  ids: readonly string[],
): string | null | undefined {
  let latest: string | undefined;
  let any = false;
  for (const id of ids) {
    if (!finishes.has(id)) continue;
    any = true;
    const finish = finishes.get(id);
    if (finish === null || finish === undefined) return null;
    if (latest === undefined || finish > latest) latest = finish;
  }
  return any ? (latest ?? null) : undefined;
}

/**
 * Every goal with at least one open, estimated task: when it would be done,
 * plain and as a range. Goals with nothing projected are left out — there is
 * no date to give them, and inventing one would be the wrong kind of help.
 */
export function forecastGoals(input: LedgerInput, calibration: Calibration): GoalForecast[] {
  const plain = project(input).finishes;
  const ranged = calibration.likely !== null && calibration.sure !== null;
  const likely = ranged ? project({ ...input, scale: calibration.likely ?? 1 }).finishes : null;
  const sure = ranged ? project({ ...input, scale: calibration.sure ?? 1 }).finishes : null;

  const out: GoalForecast[] = [];
  for (const goal of input.goals) {
    const ids = input.goalLinks
      .filter((link) => link.goalId === goal.id)
      .map((link) => link.itemId);
    const finish = lastOf(plain, ids);
    if (finish === undefined) continue;
    out.push({
      goalId: goal.id,
      plain: finish,
      likely: likely === null ? null : (lastOf(likely, ids) ?? null),
      sure: sure === null ? null : (lastOf(sure, ids) ?? null),
    });
  }
  return out;
}
