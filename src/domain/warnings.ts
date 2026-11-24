/**
 * Warnings: as many alarms as a person wants before a task is due.
 *
 * One reminder says "do not forget". A deadline that matters wants a run of them,
 * like the alarms on a clock: one on Monday, two on Tuesday, three the day before.
 * Each is an instant of its own, and each counts back from the due time, so moving
 * the task moves them with it (ADR-040).
 *
 * Pure: no I/O, no React, no host.
 */

const MINUTE = 60_000;

export interface Warning {
  id: string;
  fireAt: string;
  /** It has gone off. Kept, so a person can see what they were told and when. */
  fired: boolean;
}

/** The leads most deadlines want, one press away. */
export const WARNING_PRESETS: ReadonlyArray<{ id: string; label: string; minutes: number }> = [
  { id: '1w', label: '1 week before', minutes: 7 * 24 * 60 },
  { id: '3d', label: '3 days before', minutes: 3 * 24 * 60 },
  { id: '1d', label: '1 day before', minutes: 24 * 60 },
  { id: '1h', label: '1 hour before', minutes: 60 },
];

/** The instant a preset stands for. */
export function fireAtFor(dueAt: string, minutesBefore: number): string {
  return new Date(Date.parse(dueAt) - minutesBefore * MINUTE).toISOString();
}

/** The presets still worth offering: in the future, and not already set. */
export function presetsLeft(
  dueAt: string,
  now: string,
  warnings: readonly Warning[],
): typeof WARNING_PRESETS {
  const taken = new Set(warnings.map((warning) => Date.parse(warning.fireAt)));
  return WARNING_PRESETS.filter((preset) => {
    const at = Date.parse(fireAtFor(dueAt, preset.minutes));
    return at > Date.parse(now) && !taken.has(at);
  });
}

/** What is wrong with a time for a warning, in a sentence, or null when nothing is. */
export function checkWarning(fireAt: string, dueAt: string, now: string): string | null {
  const at = Date.parse(fireAt);
  if (Number.isNaN(at)) return 'That is not a date and time.';
  if (at <= Date.parse(now)) return 'A warning has to be in the future.';
  if (at > Date.parse(dueAt)) return 'A warning comes before the task is due.';
  return null;
}

/** How long before the due time: `2 days, 3 hours before`, `at the due time`. */
export function describeLead(fireAt: string, dueAt: string): string {
  const minutes = Math.round((Date.parse(dueAt) - Date.parse(fireAt)) / MINUTE);
  if (minutes <= 0) return 'at the due time';
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const rest = minutes % 60;
  const parts = [
    days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : null,
    hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : null,
    days === 0 && rest > 0 ? `${rest} ${rest === 1 ? 'minute' : 'minutes'}` : null,
  ].filter((part) => part !== null);
  return `${parts.join(', ')} before`;
}
