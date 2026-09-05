import { useState } from 'react';

import { useSetPlan } from '@/data/hooks';
import { formatDuration, parseDuration, type Timing } from '@/domain/criticalPath';
import type { Item } from '@/domain/item';
import { Checkbox } from '@/ui/Checkbox';
import { Input } from '@/ui/Input';
import { announce } from '@/ui/announce';

/**
 * What this task contributes to a plan: how long it takes, and whether it takes
 * any time at all.
 *
 * The estimate is typed the way a person says it — `2h 30m`, `1d`, `45` — not
 * in minutes, because the product already reads "in 3 days" when capturing a
 * task and asking for raw minutes here would be the odd one out. It commits on
 * blur, and a value it cannot read leaves the stored one alone rather than
 * turning a typo into a number.
 *
 * The timing comes from the plan computed over the whole collection, so the
 * slack shown is the real one — not this task's estimate in isolation.
 */
export function PlanEditor({ task, timing }: { task: Item; timing: Timing | undefined }) {
  const setPlan = useSetPlan();

  const asText = task.estimateMinutes === null ? '' : formatDuration(task.estimateMinutes);
  const [draft, setDraft] = useState(asText);
  const [lastStored, setLastStored] = useState(asText);
  const [unreadable, setUnreadable] = useState(false);

  // Follow the stored value when it changes elsewhere, and reset when a
  // different task is opened. Adjusted during render rather than in an effect,
  // the same way `PropertyValueEditor` does it: syncing a prop into state from
  // `useEffect` renders once stale and again fresh, which is a flicker and a
  // cascade. `task.id` is in the key so opening another task always resets,
  // even when both have the same estimate.
  const key = `${task.id}:${asText}`;
  if (lastStored !== key) {
    setLastStored(key);
    setDraft(asText);
    setUnreadable(false);
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      setUnreadable(false);
      if (task.estimateMinutes !== null) {
        setPlan.mutate({ id: task.id, estimateMinutes: null, isMilestone: task.isMilestone });
      }
      return;
    }

    const minutes = parseDuration(trimmed);
    if (minutes === null) {
      setUnreadable(true);
      return;
    }
    setUnreadable(false);
    if (minutes !== task.estimateMinutes) {
      setPlan.mutate({ id: task.id, estimateMinutes: minutes, isMilestone: task.isMilestone });
    }
  };

  const toggleMilestone = (isMilestone: boolean) => {
    setPlan.mutate(
      { id: task.id, estimateMinutes: task.estimateMinutes, isMilestone },
      {
        onSuccess: () =>
          announce(isMilestone ? `${task.title} is a milestone` : `${task.title} is work again`),
      },
    );
  };

  return (
    <section className="mt-6 border-t border-stroke-subtle pt-4">
      <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">Plan</h3>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-caption font-semibold text-fg-tertiary uppercase">
            Estimate
          </span>
          <span className="w-40">
            <Input
              aria-label="Estimate"
              value={draft}
              placeholder="2h 30m"
              disabled={task.isMilestone || setPlan.isPending}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  setDraft(asText);
                  setUnreadable(false);
                }
              }}
            />
          </span>
          {task.isMilestone && (
            <span className="text-caption text-fg-tertiary">A milestone takes no time.</span>
          )}
        </label>

        {unreadable && (
          <p className="text-caption text-caution">
            That was not read as a length, so nothing changed. Try <code>2h 30m</code>,{' '}
            <code>1d</code>, or a number of minutes.
          </p>
        )}

        <label className="flex items-center gap-2 text-body text-fg">
          <Checkbox
            checked={task.isMilestone}
            label="This is a milestone"
            disabled={setPlan.isPending}
            onChange={toggleMilestone}
          />
          <span>
            A milestone
            <span className="block text-caption text-fg-tertiary">
              A moment in the plan rather than work — no duration, whatever the estimate says.
            </span>
          </span>
        </label>

        {timing !== undefined && !task.isMilestone && (
          <p className="text-caption text-fg-tertiary">
            {timing.critical
              ? 'On the critical path: any delay here moves the end.'
              : `${formatDuration(timing.slack)} of slack — it could slip that much without moving the end.`}
          </p>
        )}
      </div>
    </section>
  );
}
