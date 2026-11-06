/**
 * Notes started from a meeting: the page's name and what it opens with.
 *
 * A meeting's notes are named for the meeting and its day, so a weekly sync has a
 * page for each week and the list of pages reads like a diary of them. The page opens
 * with when and where, then three headings a meeting usually needs: what was said,
 * what was decided, and what has to happen next. Follow-ups are written as lines and
 * turned into tasks one press at a time, which pairs each with the page.
 *
 * Pure: no I/O, no React, no host.
 */

import type { DocNode } from './document';
import { localPlace } from './schedule';

export interface Meeting {
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');

function clockOf(minute: number): string {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

function dayWords(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Weekly sync — Mon, Nov 9", on the day the meeting starts where the person is. */
export function notesTitle(meeting: Meeting, zone: string): string {
  const name = meeting.title.trim() === '' ? 'Meeting' : meeting.title.trim();
  return `${name} — ${dayWords(localPlace(meeting.startsAt, zone).day)}`;
}

/** When, and where when it is known: "Mon, Nov 9 · 10:00–11:00 · Room 2". */
export function whenAndWhere(meeting: Meeting, zone: string): string {
  const start = localPlace(meeting.startsAt, zone);
  const end = localPlace(meeting.endsAt, zone);
  const parts = [dayWords(start.day)];
  if (!meeting.allDay) parts.push(`${clockOf(start.minute)}–${clockOf(end.minute)}`);
  const place = meeting.location?.trim() ?? '';
  if (place !== '') parts.push(place);
  return parts.join(' · ');
}

const text = (value: string): DocNode[] => [{ type: 'text', text: value }];
const heading = (value: string): DocNode => ({
  type: 'heading',
  attrs: { level: 2 },
  content: text(value),
});
const paragraph = (value?: string): DocNode =>
  value === undefined ? { type: 'paragraph' } : { type: 'paragraph', content: text(value) };

/** What a meeting's page opens with. */
export function notesTemplate(meeting: Meeting, zone: string): DocNode[] {
  return [
    paragraph(whenAndWhere(meeting, zone)),
    heading('Notes'),
    paragraph(),
    heading('Decisions'),
    paragraph(),
    heading('Follow-ups'),
    paragraph(),
  ];
}
