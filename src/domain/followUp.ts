/**
 * A follow-up's first offer: the next working morning. A person changes it when it
 * is wrong, and most of the time "tomorrow morning" is what they meant.
 *
 * Pure: no I/O, no React, no host.
 */

import { addLocalDays, weekdayOf } from './calendar';
import { asInstant, localDay } from './schedule';

export function nextWorkingMorning(now: string, zone: string): string {
  let day = addLocalDays(localDay(now, zone), 1);
  while (weekdayOf(day) === 0 || weekdayOf(day) === 6) day = addLocalDays(day, 1);
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return asInstant(new Date(year, month - 1, date, 9, 0), zone);
}
