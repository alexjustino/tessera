import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, describeAge, formatBytes, readSettings } from './settings';

describe('readSettings', () => {
  it('yields the defaults for nothing, garbage, or the wrong shape', () => {
    expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings('dark')).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps every valid field and replaces each invalid one alone', () => {
    expect(
      readSettings({
        theme: 'dark',
        density: 'roomy',
        quickCaptureShortcut: 'Win+L',
        backupsEnabled: false,
        backupsKeep: 3,
      }),
    ).toEqual({
      theme: 'dark',
      density: 'comfortable',
      quickCaptureShortcut: 'Ctrl+Alt+Space',
      backupsEnabled: false,
      backupsKeep: 3,
    });
  });

  it('bounds the retention and refuses non-integers', () => {
    expect(readSettings({ backupsKeep: 0 }).backupsKeep).toBe(7);
    expect(readSettings({ backupsKeep: 51 }).backupsKeep).toBe(7);
    expect(readSettings({ backupsKeep: 2.5 }).backupsKeep).toBe(7);
    expect(readSettings({ backupsKeep: '5' }).backupsKeep).toBe(5);
    expect(readSettings({ backupsKeep: 50 }).backupsKeep).toBe(50);
  });

  it('ignores keys it does not know', () => {
    expect(readSettings({ fromTheFuture: true, theme: 'light' })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
    });
  });
});

describe('formatBytes', () => {
  it('picks the unit a person would', () => {
    expect(formatBytes(12)).toBe('12 bytes');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1_258_291)).toBe('1.2 MB');
  });
});

describe('describeAge', () => {
  const now = '2026-09-03T12:00:00.000Z';
  it('is coarse on purpose', () => {
    expect(describeAge('2026-09-03T11:59:40.000Z', now)).toBe('just now');
    expect(describeAge('2026-09-03T11:45:00.000Z', now)).toBe('15 min ago');
    expect(describeAge('2026-09-03T10:30:00.000Z', now)).toBe('1 hour ago');
    expect(describeAge('2026-09-03T06:00:00.000Z', now)).toBe('6 hours ago');
    expect(describeAge('2026-09-02T09:00:00.000Z', now)).toBe('yesterday');
    expect(describeAge('2026-08-30T09:00:00.000Z', now)).toBe('4 days ago');
  });

  it('never blames the clock', () => {
    expect(describeAge('2026-09-04T12:00:00.000Z', now)).toBe('just now');
    expect(describeAge('garbage', now)).toBe('just now');
  });
});
