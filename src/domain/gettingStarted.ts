/**
 * Getting started: what a new workspace still needs from a person.
 *
 * Everything Tessera counts is measured against the working week, and until
 * somebody says otherwise that week is a default nobody chose. Two steps can
 * only be answered by the person, so they are remembered in the settings. The
 * other two are read from the work itself, so they can never disagree with it.
 *
 * Pure: no I/O, no React, no host.
 */

import type { Item } from './item';
import type { Settings } from './settings';

export type StepId = 'hours' | 'daysOff' | 'task' | 'estimate';

export interface Step {
  readonly id: StepId;
  readonly done: boolean;
}

export function stepsOf(settings: Settings, items: readonly Item[]): Step[] {
  return [
    { id: 'hours', done: settings.guideHoursSet },
    { id: 'daysOff', done: settings.guideDaysOffSet },
    { id: 'task', done: items.length > 0 },
    { id: 'estimate', done: items.some((item) => item.estimateMinutes !== null) },
  ];
}

/** Whether the guide still has something to say. */
export function guideIsOpen(settings: Settings, items: readonly Item[]): boolean {
  return !settings.guideDismissed && stepsOf(settings, items).some((step) => !step.done);
}

/** What the rail should say about Settings, or null when it has nothing to ask. */
export function settingsAsk(settings: Settings): string | null {
  if (settings.guideDismissed) return null;
  if (!settings.guideHoursSet) return 'Your working hours are waiting to be set';
  if (!settings.guideDaysOffSet) return 'Your days off are waiting to be set';
  return null;
}
