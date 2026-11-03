import { CheckmarkCircle20Regular, Circle20Regular, Dismiss12Regular } from '@fluentui/react-icons';
import { useMemo } from 'react';

import { useItemPages, useItems, useLinkItemPage, useUnlinkItemPage } from '@/data/hooks';
import { isCompleted } from '@/domain/item';
import { IconButton } from '@/ui/IconButton';
import { Select } from '@/ui/Select';

/** The tasks this page is about. The same pairs a task shows, from this side. */
export function LinkedTasks({
  pageId,
  onOpenItem,
}: {
  pageId: string;
  onOpenItem?: ((itemId: string) => void) | undefined;
}) {
  const items = useItems(null, true);
  const pairs = useItemPages();
  const link = useLinkItemPage();
  const unlink = useUnlinkItemPage();

  const all = useMemo(() => items.data ?? [], [items.data]);
  const mine = useMemo(() => {
    const ids = new Set(
      (pairs.data ?? []).filter((pair) => pair.pageId === pageId).map((pair) => pair.itemId),
    );
    return all.filter((item) => ids.has(item.id));
  }, [pairs.data, all, pageId]);
  const offerable = all.filter(
    (item) => !isCompleted(item) && !mine.some((held) => held.id === item.id),
  );

  return (
    <section
      aria-label="Tasks about this page"
      className="mt-4 border-t border-stroke-subtle pt-3"
      data-testid="linked-tasks"
    >
      <h2 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">Tasks</h2>
      {mine.length > 0 && (
        <ul className="mb-2 flex flex-col gap-0.5">
          {mine.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-card-hover"
            >
              <span aria-hidden="true" className="shrink-0 text-fg-tertiary">
                {isCompleted(item) ? <CheckmarkCircle20Regular /> : <Circle20Regular />}
              </span>
              <button
                type="button"
                aria-label={`Open the task ${item.title}`}
                onClick={() => onOpenItem?.(item.id)}
                className="min-w-0 flex-1 truncate text-left text-body text-fg"
              >
                {item.title}
                {isCompleted(item) && <span className="sr-only"> (done)</span>}
              </button>
              <IconButton
                label={`Take ${item.title} off this page`}
                icon={<Dismiss12Regular />}
                onClick={() => unlink.mutate({ itemId: item.id, pageId })}
              />
            </li>
          ))}
        </ul>
      )}
      <Select
        aria-label="Link a task to this page"
        value=""
        onChange={(event) => {
          if (event.target.value !== '') {
            link.mutate({ itemId: event.target.value, pageId });
          }
        }}
      >
        <option value="">Link a task…</option>
        {offerable.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </Select>
    </section>
  );
}
