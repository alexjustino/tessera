import { WeatherMoon20Regular, WeatherSunny20Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { useDayReviews } from '@/data/hooks';
import { todayIn } from '@/domain/calendar';
import type { Pulse } from '@/domain/pulse';
import { ritualDue } from '@/domain/ritual';
import { localPlace, systemZone } from '@/domain/schedule';
import { Button } from '@/ui/Button';
import { useNow } from '@/ui/useNow';

import { CloseTheDay } from './CloseTheDay';
import { PlanMyDay } from './PlanMyDay';

/**
 * The day's two moments on Today (ADR-061): Plan my day and Close the day are always
 * one press away; in the morning before it is planned, and from late afternoon until it
 * is closed, the one that is due is offered with a word about why.
 */
export function RitualCard({ pulse }: { pulse: Pulse }) {
  const zone = useMemo(() => systemZone(), []);
  const now = useNow(60_000);
  const today = todayIn(now, zone);
  const record = useDayReviews(today);
  const [open, setOpen] = useState<'plan' | 'close' | null>(null);

  const mine = (record.data ?? []).find((review) => review.day === today) ?? null;
  const due = record.isSuccess ? ritualDue(localPlace(now, zone).minute, mine) : null;

  return (
    <>
      <section
        aria-label="Your day"
        data-testid="ritual"
        data-due={due ?? 'none'}
        className={[
          'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3',
          due === null ? 'border-stroke-subtle bg-card' : 'border-accent bg-accent-subtle',
        ].join(' ')}
      >
        <div className="min-w-48 flex-1">
          <p className="text-caption font-semibold text-fg uppercase">Your day</p>
          <p className="text-caption text-fg-secondary">
            {mine?.closedAt
              ? 'Closed. Tomorrow starts with what you moved to it.'
              : due === 'plan'
                ? 'Start here: what was left, what today holds, and its time on the calendar.'
                : due === 'close'
                  ? 'Before you stop: what got done, what goes to tomorrow, a line for the journal.'
                  : mine?.plannedAt
                    ? 'Planned this morning.'
                    : 'Plan it whenever you start, and close it when you stop.'}
          </p>
        </div>
        <Button
          appearance={due === 'plan' ? 'accent' : 'standard'}
          icon={<WeatherSunny20Regular />}
          onClick={() => setOpen('plan')}
        >
          Plan my day
        </Button>
        <Button
          appearance={due === 'close' ? 'accent' : 'standard'}
          icon={<WeatherMoon20Regular />}
          onClick={() => setOpen('close')}
        >
          Close the day
        </Button>
      </section>
      {open === 'plan' && <PlanMyDay pulse={pulse} onClose={() => setOpen(null)} />}
      {open === 'close' && <CloseTheDay pulse={pulse} onClose={() => setOpen(null)} />}
    </>
  );
}
