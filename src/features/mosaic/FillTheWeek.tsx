import { useState } from 'react';

import { useSetPlan } from '@/data/hooks';
import { formatDuration, parseDuration } from '@/domain/criticalPath';
import { isCompleted, type Item } from '@/domain/item';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';

/** The sizes most tasks are, one press away. An odd one goes through Open. */
const SIZES = ['30m', '1h', '2h', '4h', '1d'];

/** Enough to act on without the card outgrowing the week below it. */
const SHOWN = 6;

/**
 * The tasks the week cannot count yet.
 *
 * The Mosaic draws time, and a task with no estimate has none to draw, so a list
 * of real work could leave the whole grid empty with nothing saying why. This
 * says why, and fixes it where it is said.
 */
export function FillTheWeek({
  items,
  onOpen,
}: {
  items: readonly Item[];
  onOpen: (itemId: string) => void;
}) {
  const setPlan = useSetPlan();
  const [showAll, setShowAll] = useState(false);

  const waiting = items.filter(
    (item) => !isCompleted(item) && item.estimateMinutes === null && !item.isMilestone,
  );
  if (waiting.length === 0) return null;

  const shown = showAll ? waiting : waiting.slice(0, SHOWN);

  return (
    <div data-testid="fill-the-week">
      <Card
        title={
          waiting.length === 1
            ? '1 task has no estimate yet'
            : `${waiting.length} tasks have no estimate yet`
        }
        description="The week cannot draw work until it knows how long it takes."
      >
        <ul className="flex flex-col gap-1">
          {shown.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md px-2 py-1 hover:bg-card-hover"
            >
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="w-full min-w-0 truncate py-1 text-left text-body text-fg"
              >
                {item.title}
              </button>
              <div
                className="flex items-center gap-1"
                role="group"
                aria-label={`Size of ${item.title}`}
              >
                {SIZES.map((size) => (
                  <Button
                    key={size}
                    aria-label={`${item.title} takes ${formatDuration(parseDuration(size) ?? 0)}`}
                    disabled={setPlan.isPending}
                    className="min-w-0 px-2"
                    onClick={() =>
                      setPlan.mutate({
                        id: item.id,
                        estimateMinutes: parseDuration(size),
                        isMilestone: false,
                      })
                    }
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {waiting.length > SHOWN && (
          <div className="mt-2">
            <Button appearance="subtle" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${waiting.length}`}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
