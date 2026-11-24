/**
 * How things are said on paper (ADR-066). Pure, so a printed page says the same
 * thing in every test.
 */

/** A due date as paper says it: the day, and the time when one was set. */
export function printedDue(dueAt: string | null): string {
  if (dueAt === null) return '';
  const at = new Date(dueAt);
  const day = at.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const endOfDay = at.getHours() === 23 && at.getMinutes() === 59;
  return endOfDay
    ? day
    : `${day}, ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
