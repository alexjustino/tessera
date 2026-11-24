import { Checkmark16Regular } from '@fluentui/react-icons';
import { useMemo, type ReactNode } from 'react';

import { useSettings } from '@/data/hooks';
import { guideIsOpen, stepsOf, type StepId } from '@/domain/gettingStarted';
import type { Item } from '@/domain/item';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';

import { useGuideAnswer } from './useGuideAnswer';

/** The card in Settings a step points at. */
export type SettingsCard = 'hours' | 'daysOff';

const WORDS: Record<StepId, { title: string; why: string }> = {
  hours: {
    title: 'Say when you work',
    why: 'The calendar, the Mosaic and the price of a change all count against these hours.',
  },
  daysOff: {
    title: 'Mark your days off',
    why: 'Holidays and leave have no working hours, so nothing is planned onto them.',
  },
  task: {
    title: 'Add your first task',
    why: 'Type it in the line above, in plain words: "Call Bob tomorrow at 9am".',
  },
  estimate: {
    title: 'Give a task an estimate',
    why: 'Open a task and say how long it takes. That is what fills the Mosaic.',
  },
};

/**
 * The first thing a new workspace asks. It stays until every step is done or the
 * person hides it, and an answer can always be changed later in Settings.
 */
export function GettingStarted({
  items,
  onOpenSettings,
}: {
  items: readonly Item[];
  onOpenSettings?: ((card: SettingsCard) => void) | undefined;
}) {
  const settings = useSettings();
  const answer = useGuideAnswer();

  const steps = useMemo(
    () => (settings.data === undefined ? [] : stepsOf(settings.data, items)),
    [settings.data, items],
  );

  if (settings.data === undefined || !guideIsOpen(settings.data, items)) return null;

  const left = steps.filter((step) => !step.done).length;

  const actions: Partial<Record<StepId, ReactNode>> = {
    hours: (
      <>
        <Button onClick={() => onOpenSettings?.('hours')}>Set my hours</Button>
        <Button appearance="subtle" onClick={() => answer({ guideHoursSet: true })}>
          My hours are already right
        </Button>
      </>
    ),
    daysOff: (
      <>
        <Button onClick={() => onOpenSettings?.('daysOff')}>Add days off</Button>
        <Button appearance="subtle" onClick={() => answer({ guideDaysOffSet: true })}>
          None for now
        </Button>
      </>
    ),
  };

  return (
    <div className="print-hide" data-testid="getting-started">
      <Card
        title="Set Tessera up for your week"
        description={`${left} of ${steps.length} left. You can change any of this later in Settings.`}
        actions={
          <Button appearance="subtle" onClick={() => answer({ guideDismissed: true })}>
            Hide this guide
          </Button>
        }
      >
        <ol className="flex flex-col gap-1">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md px-2 py-2"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden="true"
                  className={[
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-caption',
                    step.done
                      ? 'bg-accent text-fg-on-accent'
                      : 'border border-stroke text-fg-secondary',
                  ].join(' ')}
                >
                  {step.done ? <Checkmark16Regular /> : index + 1}
                </span>
                <div className="min-w-0">
                  <p className={step.done ? 'text-body text-fg-tertiary' : 'text-body text-fg'}>
                    {WORDS[step.id].title}
                    {step.done && <span className="sr-only"> (done)</span>}
                  </p>
                  {!step.done && (
                    <p className="text-caption text-fg-tertiary">{WORDS[step.id].why}</p>
                  )}
                </div>
              </div>
              {!step.done && actions[step.id] !== undefined && (
                <div className="flex flex-wrap items-center gap-2">{actions[step.id]}</div>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
