import { describe, expect, it } from 'vitest';

import { guideIsOpen, settingsAsk, stepsOf } from './gettingStarted';
import type { Item } from './item';
import { DEFAULT_SETTINGS, readSettings, type Settings } from './settings';

const item = (over: Partial<Item> = {}): Item =>
  ({ id: 'a', title: 'a', estimateMinutes: null, ...over }) as Item;
const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });
const answered = { guideHoursSet: true, guideDaysOffSet: true };

describe('the steps', () => {
  it('start with everything still to do', () => {
    expect(stepsOf(settings(), []).every((step) => !step.done)).toBe(true);
  });

  it('read tasks and estimates from the work itself', () => {
    const steps = stepsOf(settings(), [item({ estimateMinutes: 60 })]);
    expect(steps.find((step) => step.id === 'task')?.done).toBe(true);
    expect(steps.find((step) => step.id === 'estimate')?.done).toBe(true);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('does not count a task with no estimate as estimated', () => {
    const steps = stepsOf(settings(), [item()]);
    expect(steps.find((step) => step.id === 'estimate')?.done).toBe(false);
  });
});

describe('the guide', () => {
  it('is open while a step is left', () => {
    expect(guideIsOpen(settings(answered), [])).toBe(true);
  });

  it('closes by itself when every step is done', () => {
    expect(guideIsOpen(settings(answered), [item({ estimateMinutes: 60 })])).toBe(false);
  });

  it('stays closed once hidden, with steps still left', () => {
    expect(guideIsOpen(settings({ guideDismissed: true }), [])).toBe(false);
  });
});

describe('what the rail says about Settings', () => {
  it('asks for the hours first, then the days off', () => {
    expect(settingsAsk(settings())).toMatch(/working hours/);
    expect(settingsAsk(settings({ guideHoursSet: true }))).toMatch(/days off/);
  });

  it('asks nothing once both are answered', () => {
    expect(settingsAsk(settings(answered))).toBeNull();
  });

  it('asks nothing once the guide is hidden', () => {
    expect(settingsAsk(settings({ guideDismissed: true }))).toBeNull();
  });
});

describe('reading the settings', () => {
  it('treats a workspace from before the guide as not yet answered', () => {
    const read = readSettings({ theme: 'dark' });
    expect(read.guideHoursSet).toBe(false);
    expect(read.guideDaysOffSet).toBe(false);
    expect(read.guideDismissed).toBe(false);
  });

  it('refuses anything but a boolean', () => {
    expect(readSettings({ guideHoursSet: 'yes' }).guideHoursSet).toBe(false);
  });
});
