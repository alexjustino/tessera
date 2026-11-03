import { describe, expect, it } from 'vitest';

import { checkWarning, describeLead, fireAtFor, presetsLeft, type Warning } from './warnings';

const DUE = '2026-11-10T13:00:00.000Z';
const NOW = '2026-11-02T12:00:00.000Z';
const warning = (fireAt: string): Warning => ({ id: fireAt, fireAt, fired: false });

describe('how far ahead a warning is', () => {
  it('counts back from the due time', () => {
    expect(fireAtFor(DUE, 60)).toBe('2026-11-10T12:00:00.000Z');
  });

  it.each([
    ['2026-11-10T12:00:00.000Z', '1 hour before'],
    ['2026-11-09T13:00:00.000Z', '1 day before'],
    ['2026-11-08T10:00:00.000Z', '2 days, 3 hours before'],
    ['2026-11-10T12:45:00.000Z', '15 minutes before'],
  ])('%s reads as %s', (fireAt, words) => {
    expect(describeLead(fireAt, DUE)).toBe(words);
  });

  it('says so when it is the due time itself', () => {
    expect(describeLead(DUE, DUE)).toBe('at the due time');
  });
});

describe('the presets on offer', () => {
  it('offers them all with plenty of time', () => {
    expect(presetsLeft(DUE, NOW, []).map((preset) => preset.id)).toEqual(['1w', '3d', '1d', '1h']);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('leaves out what has already gone', () => {
    const soon = '2026-11-02T18:00:00.000Z';
    expect(presetsLeft(soon, NOW, []).map((preset) => preset.id)).toEqual(['1h']);
  });

  it('leaves out what is already set', () => {
    const set = [warning(fireAtFor(DUE, 24 * 60))];
    expect(presetsLeft(DUE, NOW, set).map((preset) => preset.id)).toEqual(['1w', '3d', '1h']);
  });
});

describe('checking a time', () => {
  it('accepts a time between now and the due time', () => {
    expect(checkWarning('2026-11-05T09:00:00.000Z', DUE, NOW)).toBeNull();
  });

  it('accepts the due time itself', () => {
    expect(checkWarning(DUE, DUE, NOW)).toBeNull();
  });

  it('refuses the past', () => {
    expect(checkWarning('2026-11-01T09:00:00.000Z', DUE, NOW)).toMatch(/future/);
  });

  it('refuses a warning after the task is due', () => {
    expect(checkWarning('2026-11-11T09:00:00.000Z', DUE, NOW)).toMatch(/before/);
  });

  it('refuses what is not a date', () => {
    expect(checkWarning('soon', DUE, NOW)).toMatch(/date/);
  });
});
