import {
  CheckmarkCircle20Filled,
  ChevronLeft20Regular,
  ChevronRight20Regular,
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import {
  useDependencies,
  useGoalLinks,
  useGoals,
  useItems,
  useTimeBlockedItems,
  useWorkHours,
} from '@/data/hooks';
import { todayIn } from '@/domain/calendar';
import { formatDuration } from '@/domain/criticalPath';
import { periodOf, shiftPeriod, traceable } from '@/domain/report';
import { buildReview, describeGap, isFinished } from '@/domain/review';
import { systemZone } from '@/domain/schedule';
import { FigureRow } from '@/features/reports/FigureRow';
import { describePeriod } from '@/features/reports/format';
import { Card } from '@/ui/Card';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { useNow } from '@/ui/useNow';

/**
 * The weekly review — the screen that shows what is missing.
 *
 * Three questions, in the order somebody actually works through them: which
 * goals have nothing to pick up next, which tasks were freed by work that has
 * since been finished, and how much estimated work is due with no time set
 * aside for it.
 *
 * There is nothing to press to say the review is done (ADR-032). It is done
 * when the first two lists are empty, which is a fact about the workspace
 * rather than a claim about the person — and the screen says so only then.
 */
export function ReviewPage({ onOpenItem }: { onOpenItem?: (id: string) => void }) {
  const zone = useMemo(() => systemZone(), []);
  const now = useNow(null);
  const [anchor, setAnchor] = useState(() => todayIn(now, zone));
  const period = useMemo(() => periodOf('week', anchor), [anchor]);

  const goals = useGoals();
  const goalLinks = useGoalLinks();
  const items = useItems(null, true);
  const dependencies = useDependencies();
  const blocked = useTimeBlockedItems();
  const hours = useWorkHours();

  const review = useMemo(
    () =>
      buildReview(
        {
          goals: goals.data ?? [],
          goalLinks: goalLinks.data ?? [],
          items: items.data ?? [],
          edges: dependencies.data ?? [],
          reserved: new Set(blocked.data ?? []),
          period,
          hours: hours.data ?? [],
        },
        now,
        zone,
      ),
    [
      goals.data,
      goalLinks.data,
      items.data,
      dependencies.data,
      blocked.data,
      period,
      hours.data,
      now,
      zone,
    ],
  );

  const failure = goals.error ?? items.error ?? dependencies.error ?? hours.error;
  const broken = traceable(review.unscheduled) ? [] : [review.unscheduled];
  const over = review.unscheduled.value > review.capacityLeft;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold text-fg">Review</h1>
          <p className="mt-1 text-body text-fg-secondary">
            What is missing, once a week: a goal with no next action, a task nothing is holding up
            any more, and work due with no time set aside.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            label="The week before"
            icon={<ChevronLeft20Regular />}
            onClick={() => setAnchor(shiftPeriod(period, -1).firstDay)}
          />
          <IconButton
            label="The week after"
            icon={<ChevronRight20Regular />}
            onClick={() => setAnchor(shiftPeriod(period, 1).firstDay)}
          />
          {/* Which week this is. Two arrows and no date is a screen that
              cannot say what it is showing — the artefact made that plain. */}
          <h2 className="ml-2 text-body-lg font-semibold text-fg">{describePeriod(period)}</h2>
        </div>
      </header>

      {failure !== null && failure !== undefined && (
        <InfoBar severity="danger" title="The review could not be read">
          {describeError(failure)}
        </InfoBar>
      )}

      {isFinished(review) && (
        <InfoBar severity="success" title="Nothing is waiting on you">
          Every goal has something to pick up next, and no task is waiting for work that is already
          done. That is the review finished.
        </InfoBar>
      )}

      <Card
        title="Projects with no next action"
        description="A goal nobody can move. Put a task in it, or take something out of the way."
      >
        {review.projects.length === 0 ? (
          <p className="flex items-center gap-2 text-body text-fg-secondary">
            <CheckmarkCircle20Filled className="text-success" aria-hidden="true" />
            Every goal has something to pick up.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="review-projects">
            {review.projects.map((gap) => (
              <li key={gap.goal.id} className="flex items-baseline gap-3 rounded-md px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-body text-fg">{gap.goal.name}</span>
                <span className="shrink-0 text-caption text-fg-tertiary">{describeGap(gap)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Waiting on nothing"
        description="These were blocked. What they were waiting for is finished, and nobody has picked them up."
      >
        {review.waiting.length === 0 ? (
          <p className="flex items-center gap-2 text-body text-fg-secondary">
            <CheckmarkCircle20Filled className="text-success" aria-hidden="true" />
            No task is waiting for work that is already done.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="review-waiting">
            {review.waiting.map((row) => (
              <li key={row.item.id} className="flex items-baseline gap-3">
                <button
                  type="button"
                  aria-label={`Open ${row.item.title}`}
                  onClick={() => onOpenItem?.(row.item.id)}
                  className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-body text-fg hover:bg-card-hover"
                >
                  {row.item.title}
                </button>
                <span className="shrink-0 text-caption text-fg-tertiary">
                  was waiting for {row.blockers.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Planned but not scheduled"
        description="Estimated work due this week with no time reserved for it, against the working time the week has left."
      >
        <div className="flex flex-col gap-2">
          <FigureRow
            figure={{ ...review.unscheduled, label: 'Due, unreserved' }}
            broken={broken}
            big
          />
          <p className={`text-caption ${over ? 'text-caution' : 'text-fg-tertiary'}`}>
            {formatDuration(review.capacityLeft)} of working time left this week
            {over ? ' — less than the work that is due.' : '.'}
          </p>
        </div>
      </Card>
    </div>
  );
}
