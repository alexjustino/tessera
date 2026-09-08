import { ChevronLeft20Regular, ChevronRight20Regular, Print20Regular } from '@fluentui/react-icons';
import { useMemo, useState, type ReactNode } from 'react';

import { describeError } from '@/data/errors';
import {
  useCalendars,
  useEventExceptions,
  useEvents,
  useItems,
  useTimeEntries,
  useWorkHours,
} from '@/data/hooks';
import { addLocalDays, expand, todayIn } from '@/domain/calendar';
import { formatDuration } from '@/domain/criticalPath';
import {
  buildReport,
  figuresOf,
  periodOf,
  shiftPeriod,
  traceable,
  type Period,
  type PeriodKind,
} from '@/domain/report';
import { occurrencesBetween, systemZone } from '@/domain/schedule';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { TabStrip } from '@/ui/TabStrip';
import { useNow } from '@/ui/useNow';

import { describeDay } from './describeDay';
import { FigureRow } from './FigureRow';

/**
 * Reports: a week or a month, and what happened in it.
 *
 * Every number on this page can be opened. A figure is a button; pressing it
 * lists the rows it was added up from — the entries, the tasks, the blocks —
 * with their own contribution beside each, so the total can be checked by
 * eye. The domain promises the sum matches (`traceable`), the page asserts it
 * on every render, and if it ever did not the page would say so rather than
 * show the number.
 */
export function ReportsPage() {
  const zone = useMemo(() => systemZone(), []);
  // Ticks while a timer runs, so a running entry's share keeps growing here
  // the way it does on the task.
  const entries = useTimeEntries();
  const hasRunning = (entries.data ?? []).some((entry) => entry.endedAt === null);
  const now = useNow(hasRunning ? 60_000 : null);
  const today = todayIn(now, zone);

  const [kind, setKind] = useState<PeriodKind>('week');
  const [anchor, setAnchor] = useState(today);
  const period = useMemo(() => periodOf(kind, anchor), [kind, anchor]);

  const items = useItems(null, true);
  const calendars = useCalendars();
  const workHours = useWorkHours();
  const exceptions = useEventExceptions();

  const from = useMemo(() => new Date(`${period.firstDay}T00:00:00`).toISOString(), [period]);
  const to = useMemo(
    () => new Date(`${addLocalDays(period.lastDay, 1)}T00:00:00`).toISOString(),
    [period],
  );
  const events = useEvents(from, to, calendars.data ?? []);

  const occurrences = useMemo(
    () =>
      expand(events.data ?? [], exceptions.data ?? [], from, to, (event, windowFrom, windowTo) =>
        occurrencesBetween(
          {
            startAt: null,
            dueAt: event.startsAt,
            remindAt: null,
            rule: event.rrule,
            mode: 'schedule',
          },
          windowFrom,
          windowTo,
          event.tz,
        ),
      ),
    [events.data, exceptions.data, from, to],
  );

  const report = useMemo(
    () =>
      buildReport(
        period,
        {
          entries: entries.data ?? [],
          items: items.data ?? [],
          occurrences,
          hours: workHours.data ?? [],
        },
        zone,
        now,
      ),
    [period, entries.data, items.data, occurrences, workHours.data, zone, now],
  );

  const failure = entries.error ?? items.error ?? events.error ?? workHours.error;
  const untraceable = figuresOf(report).filter((figure) => !traceable(figure));
  const nothing =
    report.tracked.value === 0 && report.completed.value === 0 && report.reserved.value === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-fg">Reports</h1>
          <p className="mt-1 text-body text-fg-secondary">
            What a week or a month held. Open any number to see the rows it was added up from.
          </p>
        </div>
        {/* Printing is the window's own: the dialog it opens is where a person
            chooses a printer or a PDF, and this product does not need to know
            which (ADR-031). */}
        <Button
          appearance="subtle"
          icon={<Print20Regular />}
          className="print-hide shrink-0"
          onClick={() => window.print()}
        >
          Print
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <TabStrip
          tabs={[
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
          ]}
          active={kind}
          onSelect={(id) => setKind(id as PeriodKind)}
        />
        <div className="flex items-center gap-1">
          <IconButton
            label="Previous period"
            icon={<ChevronLeft20Regular />}
            onClick={() => setAnchor(shiftPeriod(period, -1).firstDay)}
          />
          <IconButton
            label="Next period"
            icon={<ChevronRight20Regular />}
            onClick={() => setAnchor(shiftPeriod(period, 1).firstDay)}
          />
          <Button appearance="subtle" onClick={() => setAnchor(today)}>
            This {kind}
          </Button>
        </div>
        <h2 className="text-body-lg font-semibold text-fg" data-testid="report-period">
          {describePeriod(period)}
        </h2>
      </div>

      {failure !== null && failure !== undefined && (
        <InfoBar severity="danger" title="The report could not be read">
          {describeError(failure)}
        </InfoBar>
      )}

      {untraceable.length > 0 && (
        <InfoBar severity="danger" title="A figure does not add up">
          {untraceable.map((figure) => figure.label).join(', ')} — the rows shown do not sum to the
          number. The number is withheld until they do.
        </InfoBar>
      )}

      {nothing ? (
        <EmptyState
          title="Nothing happened in this period"
          description="Nothing tracked, nothing completed, nothing reserved on the calendar. Try another week, or start a timer on a task."
        />
      ) : (
        <>
          <Card title="Tracked" description="Time recorded by the clock, split at midnight.">
            <div className="flex flex-col gap-3">
              {/* The card already says Tracked; the figure says what of it. */}
              <FigureRow figure={{ ...report.tracked, label: 'Total' }} broken={untraceable} big />
              {report.trackedByTask.length > 0 && (
                <Group label="By task">
                  {report.trackedByTask.map((figure) => (
                    <FigureRow key={figure.id} figure={figure} broken={untraceable} />
                  ))}
                </Group>
              )}
              {report.trackedByDay.length > 0 && (
                <Group label="By day">
                  {report.trackedByDay.map((figure) => (
                    <FigureRow
                      key={figure.id}
                      figure={{ ...figure, label: describeDay(figure.label) }}
                      broken={untraceable}
                    />
                  ))}
                </Group>
              )}
            </div>
          </Card>

          <Card title="Done" description="Tasks completed in the period.">
            <FigureRow figure={report.completed} broken={untraceable} big />
          </Card>

          <Card
            title="Against the estimate"
            description="For tasks worked on in the period: everything ever tracked, beside what was estimated."
          >
            {report.againstEstimate.length === 0 ? (
              <p className="text-caption text-fg-tertiary">
                None of the tasks worked on has an estimate, so there is nothing to compare.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <FigureRow figure={report.overEstimate} broken={untraceable} big />
                <ul className="flex flex-col gap-1">
                  {report.againstEstimate.map((line) => {
                    const over = line.trackedMinutes > line.estimateMinutes;
                    return (
                      <li
                        key={line.itemId}
                        className="flex items-center gap-3 text-body text-fg"
                        data-testid="estimate-line"
                      >
                        <span className="min-w-0 flex-1 truncate">{line.title}</span>
                        <span className="tabular-nums text-fg-secondary">
                          {formatDuration(line.trackedMinutes)} of{' '}
                          {formatDuration(line.estimateMinutes)}
                        </span>
                        <span
                          className={[
                            'w-16 text-right tabular-nums text-caption',
                            over ? 'text-danger' : 'text-success',
                          ].join(' ')}
                        >
                          {over ? 'over' : 'under'}{' '}
                          {formatDuration(Math.abs(line.trackedMinutes - line.estimateMinutes))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>

          <Card
            title="Reserved"
            description="What the calendar held, against the working hours the period had."
          >
            <div className="flex flex-col gap-2">
              <FigureRow figure={{ ...report.reserved, label: 'Total' }} broken={untraceable} big />
              <p className="text-caption text-fg-tertiary" data-testid="capacity">
                {report.capacity === 0
                  ? 'No working hours in this period.'
                  : `${formatDuration(report.reserved.value)} of ${formatDuration(report.capacity)} working time (${Math.round((report.reserved.value / report.capacity) * 100)}%).`}
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-caption font-semibold text-fg-tertiary uppercase">{label}</h3>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

/**
 * A figure and, on request, its rows.
 *
 * The number is a button, not text: pressing it discloses the list, and the
 * button says so to a screen reader through `aria-expanded`. A figure that
 * does not add up shows no number at all — the rule the page is built on.
 */
function describePeriod(period: Period): string {
  const [year, month, date] = period.firstDay.split('-').map(Number);
  const start = new Date(year!, month! - 1, date!);
  if (period.kind === 'month') {
    return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  const [ly, lm, ld] = period.lastDay.split('-').map(Number);
  const end = new Date(ly!, lm! - 1, ld!);
  return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
