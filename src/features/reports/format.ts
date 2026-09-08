/**
 * Days and periods, said the way a person reads a date: `Mon 8 Sep`, and
 * `7 Sep – 13 Sep, 2026`.
 *
 * Their own file so the components that use them stay files of components —
 * which is what keeps the editor's fast refresh working while a report is
 * open — and so the review and the report say a week the same way.
 */
import type { Period } from '@/domain/report';
export function describeDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** The week or month a period covers, as a person would name it. */
export function describePeriod(period: Period): string {
  const [year, month, date] = period.firstDay.split('-').map(Number);
  const start = new Date(year!, month! - 1, date!);
  if (period.kind === 'month') {
    return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  const [ly, lm, ld] = period.lastDay.split('-').map(Number);
  const end = new Date(ly!, lm! - 1, ld!);
  return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
