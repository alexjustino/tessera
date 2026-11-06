import { Dismiss12Regular, Notebook20Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import {
  useCreatePage,
  useItemPages,
  useLinkItemPage,
  usePages,
  useUnlinkItemPage,
} from '@/data/hooks';
import { between } from '@/domain/ordering';
import { titleKey } from '@/domain/page';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Select } from '@/ui/Select';

/**
 * The pages about this task: start one from here, or pair one that already
 * exists. A short note belongs in the box above; this is for the ones that grow.
 */
export function LinkedNotes({
  itemId,
  title,
  onOpenPage,
}: {
  itemId: string;
  title: string;
  onOpenPage?: ((pageId: string) => void) | undefined;
}) {
  const pages = usePages();
  const pairs = useItemPages();
  const link = useLinkItemPage();
  const unlink = useUnlinkItemPage();
  const create = useCreatePage();
  const [chosen, setChosen] = useState('');

  const all = useMemo(() => pages.data ?? [], [pages.data]);
  const mine = useMemo(() => {
    const ids = new Set(
      (pairs.data ?? []).filter((pair) => pair.itemId === itemId).map((pair) => pair.pageId),
    );
    return all.filter((page) => ids.has(page.id));
  }, [pairs.data, all, itemId]);
  const others = all.filter((page) => !mine.some((held) => held.id === page.id));

  const startNote = () => {
    const taken = new Set(all.map((page) => titleKey(page.title)));
    let name = title;
    for (let n = 2; taken.has(titleKey(name)); n += 1) name = `${title} ${n}`;
    create.mutate(
      { title: name, position: between(all.at(-1)?.position ?? null, null) },
      {
        onSuccess: (page) =>
          link.mutate({ itemId, pageId: page.id }, { onSuccess: () => onOpenPage?.(page.id) }),
      },
    );
  };

  const failure = pages.error ?? pairs.error ?? link.error ?? unlink.error ?? create.error;

  return (
    <section aria-label="Pages about this task" className="mb-5" data-testid="linked-notes">
      <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">
        Pages about this task
      </h3>
      {failure !== null && failure !== undefined && (
        <InfoBar severity="danger" title="That did not work">
          {describeError(failure)}
        </InfoBar>
      )}
      {mine.length > 0 && (
        <ul className="mb-2 flex flex-col gap-0.5">
          {mine.map((page) => (
            <li
              key={page.id}
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-card-hover"
            >
              <Notebook20Regular aria-hidden="true" className="shrink-0 text-fg-tertiary" />
              <button
                type="button"
                aria-label={`Open the page ${page.title}`}
                onClick={() => onOpenPage?.(page.id)}
                className="min-w-0 flex-1 truncate text-left text-body text-fg"
              >
                {page.title}
              </button>
              <IconButton
                label={`Take ${page.title} off this task`}
                icon={<Dismiss12Regular />}
                onClick={() => unlink.mutate({ itemId, pageId: page.id })}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={create.isPending || link.isPending} onClick={startNote}>
          New page for this task
        </Button>
        {others.length > 0 && (
          <div className="flex min-w-48 flex-1 items-center gap-2">
            <Select
              aria-label="Link a page to this task"
              value={chosen}
              onChange={(event) => {
                setChosen('');
                if (event.target.value !== '') {
                  link.mutate({ itemId, pageId: event.target.value });
                }
              }}
            >
              <option value="">Link a page…</option>
              {others.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
    </section>
  );
}
