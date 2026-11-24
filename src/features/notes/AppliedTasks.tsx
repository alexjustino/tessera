import {
  Add16Regular,
  CheckmarkCircle16Regular,
  Circle16Regular,
  Dismiss12Regular,
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { useItemPages, useItems, useLinkItemPage, useUnlinkItemPage } from '@/data/hooks';
import { isCompleted } from '@/domain/item';
import { titleKey } from '@/domain/page';
import { formatDue, systemZone } from '@/domain/schedule';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { announce } from '@/ui/announce';

/** How many tasks the picker lists before asking to narrow it down. */
const SHOWN = 30;

/**
 * The tasks this page is applied to, right under its name.
 *
 * The owner's words: something to apply the note to a task, and leave visible that it
 * was. So it sits at the top and not in a side panel, each task one press away, and the
 * task's own row says the same thing back. The pair is the one a task shows (ADR-041).
 */
export function AppliedTasks({
  pageId,
  pageTitle,
  onOpenItem,
}: {
  pageId: string;
  pageTitle: string;
  /** Go to a task, from a page about it. */
  onOpenItem?: ((itemId: string) => void) | undefined;
}) {
  const items = useItems(null, true);
  const pairs = useItemPages();
  const link = useLinkItemPage();
  const unlink = useUnlinkItemPage();
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');

  const all = useMemo(() => items.data ?? [], [items.data]);
  const mine = useMemo(() => {
    const ids = new Set(
      (pairs.data ?? []).filter((pair) => pair.pageId === pageId).map((pair) => pair.itemId),
    );
    return all.filter((item) => ids.has(item.id));
  }, [pairs.data, all, pageId]);

  const offered = useMemo(() => {
    const key = titleKey(filter);
    return all.filter(
      (item) =>
        !isCompleted(item) &&
        !mine.some((held) => held.id === item.id) &&
        (key === '' || titleKey(item.title).includes(key)),
    );
  }, [all, mine, filter]);

  const now = new Date().toISOString();
  const zone = systemZone();

  const close = () => {
    setPicking(false);
    setFilter('');
  };

  return (
    <section
      aria-label="Tasks this page is applied to"
      data-testid="linked-tasks"
      className="flex flex-wrap items-center gap-1.5"
    >
      <span className="mr-1 text-caption font-semibold text-fg-tertiary">
        {mine.length === 0 ? 'Not applied to a task yet' : 'Applied to'}
      </span>
      {mine.map((item) => (
        <span
          key={item.id}
          data-applied-task={item.id}
          className="inline-flex max-w-72 items-center gap-1 rounded-md border border-accent/40 bg-accent-subtle py-0.5 pr-0.5 pl-1.5 text-caption text-fg"
        >
          <span aria-hidden="true" className="flex shrink-0 text-accent">
            {isCompleted(item) ? <CheckmarkCircle16Regular /> : <Circle16Regular />}
          </span>
          <button
            type="button"
            aria-label={`Open the task ${item.title}`}
            title={item.title}
            onClick={() => onOpenItem?.(item.id)}
            className="min-w-0 truncate text-left font-semibold hover:underline"
          >
            {item.title}
            {isCompleted(item) && <span className="sr-only"> (done)</span>}
          </button>
          <button
            type="button"
            aria-label={`Take ${item.title} off this page`}
            title="Take it off this page"
            onClick={() => unlink.mutate({ itemId: item.id, pageId })}
            className="flex shrink-0 rounded-sm p-1 text-fg-tertiary hover:bg-card-hover hover:text-fg"
          >
            <Dismiss12Regular aria-hidden="true" />
          </button>
        </span>
      ))}
      <Button appearance="subtle" icon={<Add16Regular />} onClick={() => setPicking(true)}>
        Apply to a task
      </Button>

      <Modal open={picking} label={`Apply ${pageTitle} to a task`} onClose={close}>
        <div className="flex flex-col gap-3 p-4">
          <h2 className="text-body-lg font-semibold text-fg">Apply {pageTitle} to a task</h2>
          <p className="text-caption text-fg-tertiary">
            The task shows this page on its row, and opens it from there.
          </p>
          <Input
            autoFocus
            aria-label="Find a task"
            placeholder="Find a task"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {offered.length === 0 ? (
            <p className="text-body text-fg-tertiary">No open task matches.</p>
          ) : (
            <ul aria-label="Open tasks" className="flex max-h-80 flex-col overflow-y-auto">
              {offered.slice(0, SHOWN).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={link.isPending}
                    onClick={() =>
                      link.mutate(
                        { itemId: item.id, pageId },
                        {
                          onSuccess: () => {
                            announce(`${pageTitle} applied to ${item.title}`);
                            close();
                          },
                        },
                      )
                    }
                    className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-2 text-left text-body text-fg hover:bg-card-hover"
                  >
                    <span className="min-w-0 truncate">{item.title}</span>
                    {item.dueAt !== null && (
                      <span className="shrink-0 text-caption text-fg-tertiary">
                        {formatDue(item.dueAt, now, zone)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {offered.length > SHOWN && (
            <p className="text-caption text-fg-tertiary">
              And {offered.length - SHOWN} more. Type to narrow them down.
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
}
