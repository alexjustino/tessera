import { useMemo } from 'react';

import { systemZone } from '@/domain/schedule';
import { comingUp } from '@/domain/today';
import type { Item } from '@/domain/item';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip } from '@/ui/Chip';

/** How many of the days ahead fit before the card stops being a glance. */
const SHOWN = 6;

/**
 * Beside what is due now: what comes next, and how much has no date. It is what
 * says how Today relates to Tasks, which is the whole of the list.
 */
export function ComingUp({
  items,
  onOpen,
  onShowAll,
}: {
  items: readonly Item[];
  onOpen: (item: Item) => void;
  onShowAll?: (() => void) | undefined;
}) {
  const { upcoming, undated } = useMemo(
    () => comingUp(items, new Date().toISOString(), systemZone()),
    [items],
  );

  if (upcoming.length === 0 && undated === 0) return null;

  return (
    <Card
      title="Coming up"
      description={
        upcoming.length === 0
          ? 'Nothing is due in the next seven days.'
          : 'The next seven days. Nothing here needs you today.'
      }
    >
      <div className="flex flex-col gap-2" data-testid="coming-up">
        {upcoming.length > 0 && (
          <ul className="flex flex-col">
            {upcoming.slice(0, SHOWN).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-body text-fg hover:bg-card-hover"
                >
                  <span className="truncate">{item.title}</span>
                  <Chip tone="neutral">
                    {new Date(item.dueAt ?? '').toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Chip>
                </button>
              </li>
            ))}
          </ul>
        )}
        {upcoming.length > SHOWN && (
          <p className="text-caption text-fg-tertiary">And {upcoming.length - SHOWN} more.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-caption text-fg-tertiary">
            {undated === 0
              ? 'Every open task has a date.'
              : `${undated} open task${undated === 1 ? ' has' : 's have'} no date, so ${undated === 1 ? 'it stays' : 'they stay'} off Today.`}
          </p>
          {onShowAll !== undefined && (
            <Button appearance="subtle" onClick={onShowAll}>
              See all tasks
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
