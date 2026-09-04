import { describe, expect, it } from 'vitest';

import {
  describePlacement,
  firstSlot,
  instantOf,
  isMoveKey,
  moveByKey,
  placeOf,
  type MoveBounds,
} from './moveByKeys';

const ZONE = 'America/Sao_Paulo';
const bounds: MoveBounds = {
  days: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'],
  zone: ZONE,
  workStartsMinute: 9 * 60,
  workEndsMinute: 18 * 60,
};
const hour = 60 * 60_000;
const at = (day: string, minute: number) => instantOf(day, minute, ZONE);

describe('placeOf and instantOf', () => {
  it('round-trip through the zone', () => {
    const instant = at('2026-09-08', 9 * 60 + 15);
    expect(instant).toBe('2026-09-08T12:15:00.000Z');
    expect(placeOf(instant, ZONE)).toEqual({ day: '2026-09-08', minute: 9 * 60 + 15 });
  });

  it('a different zone is a different instant for the same wall clock', () => {
    expect(instantOf('2026-09-08', 9 * 60, 'Asia/Tokyo')).toBe('2026-09-08T00:00:00.000Z');
  });
});

describe('moveByKey', () => {
  const carried = { startsAt: at('2026-09-08', 9 * 60), durationMs: hour };

  it('up and down move by the snap, page keys by an hour', () => {
    expect(placeOf(moveByKey(carried, 'ArrowDown', bounds), ZONE).minute).toBe(9 * 60 + 15);
    expect(placeOf(moveByKey(carried, 'ArrowUp', bounds), ZONE).minute).toBe(8 * 60 + 45);
    expect(placeOf(moveByKey(carried, 'PageDown', bounds), ZONE).minute).toBe(10 * 60);
    expect(placeOf(moveByKey(carried, 'PageUp', bounds), ZONE).minute).toBe(8 * 60);
  });

  it('left and right move a day inside the visible range, and stop at its edges', () => {
    expect(placeOf(moveByKey(carried, 'ArrowRight', bounds), ZONE).day).toBe('2026-09-09');
    expect(placeOf(moveByKey(carried, 'ArrowLeft', bounds), ZONE).day).toBe('2026-09-07');
    const first = { ...carried, startsAt: at('2026-09-07', 9 * 60) };
    expect(moveByKey(first, 'ArrowLeft', bounds)).toBe(first.startsAt);
    const last = { ...carried, startsAt: at('2026-09-11', 9 * 60) };
    expect(moveByKey(last, 'ArrowRight', bounds)).toBe(last.startsAt);
  });

  it('a day move keeps the time of day', () => {
    const late = { ...carried, startsAt: at('2026-09-08', 17 * 60 + 30) };
    expect(placeOf(moveByKey(late, 'ArrowRight', bounds), ZONE).minute).toBe(17 * 60 + 30);
  });

  it('never leaves the day: the block ends by midnight and starts no earlier than it', () => {
    const early = { ...carried, startsAt: at('2026-09-08', 0) };
    expect(placeOf(moveByKey(early, 'ArrowUp', bounds), ZONE).minute).toBe(0);
    const late = { startsAt: at('2026-09-08', 23 * 60), durationMs: hour };
    expect(placeOf(moveByKey(late, 'ArrowDown', bounds), ZONE).minute).toBe(23 * 60);
    const long = { startsAt: at('2026-09-08', 20 * 60), durationMs: 5 * hour };
    expect(placeOf(moveByKey(long, 'PageDown', bounds), ZONE).minute).toBe(19 * 60);
  });

  it('Home and End go to the working day, End leaving room for the block', () => {
    expect(placeOf(moveByKey(carried, 'Home', bounds), ZONE).minute).toBe(9 * 60);
    expect(placeOf(moveByKey(carried, 'End', bounds), ZONE).minute).toBe(17 * 60);
    const twoHours = { ...carried, durationMs: 2 * hour };
    expect(placeOf(moveByKey(twoHours, 'End', bounds), ZONE).minute).toBe(16 * 60);
  });

  it('snaps an off-grid start before moving it', () => {
    const odd = { startsAt: at('2026-09-08', 9 * 60 + 7), durationMs: hour };
    expect(placeOf(moveByKey(odd, 'ArrowDown', bounds), ZONE).minute).toBe(9 * 60 + 15);
  });

  it('a start outside the visible days cannot move sideways', () => {
    const elsewhere = { startsAt: at('2026-10-01', 9 * 60), durationMs: hour };
    expect(moveByKey(elsewhere, 'ArrowRight', bounds)).toBe(elsewhere.startsAt);
  });
});

describe('firstSlot', () => {
  it('is the working start of today when today is visible, else the first day', () => {
    expect(placeOf(firstSlot(bounds, '2026-09-09'), ZONE)).toEqual({
      day: '2026-09-09',
      minute: 9 * 60,
    });
    expect(placeOf(firstSlot(bounds, '2026-08-01'), ZONE).day).toBe('2026-09-07');
    expect(placeOf(firstSlot(bounds, '2026-12-01'), ZONE).day).toBe('2026-09-07');
  });
});

describe('the words', () => {
  it('describePlacement reads like a person would say it', () => {
    expect(
      describePlacement({ startsAt: at('2026-09-08', 9 * 60 + 15), durationMs: hour }, ZONE),
    ).toBe('Tue 8 Sep, 09:15 to 10:15');
  });

  it('isMoveKey knows the eight keys and nothing else', () => {
    for (const key of [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ]) {
      expect(isMoveKey(key)).toBe(true);
    }
    expect(isMoveKey('Enter')).toBe(false);
    expect(isMoveKey('a')).toBe(false);
  });
});
