/**
 * A local day, said the way a person reads a date beside a number: `Mon 8 Sep`.
 *
 * Its own file so the components that use it stay files of components — which
 * is what keeps the editor's fast refresh working while a report is open.
 */
export function describeDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
