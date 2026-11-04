import {
  Add20Regular,
  Delete20Regular,
  Rename20Regular,
  TagMultiple20Regular,
  TaskListSquareLtr16Regular,
} from '@fluentui/react-icons';
import { Suspense, useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useCreatePage, useDeletePage, useItemPages, usePages, useRenamePage } from '@/data/hooks';
import { between } from '@/domain/ordering';
import { checkTitle, titleKey, UNTITLED, type Page } from '@/domain/page';
import { Editor } from '@/app/lazyPages';
import { AppliedTasks } from './AppliedTasks';
import { Connections } from './Connections';
import { MarkedLines } from './MarkedLines';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Skeleton } from '@/ui/Skeleton';
import { announce } from '@/ui/announce';

/**
 * Notes — pages, and what points at them.
 *
 * The screen is three columns of one idea: the pages you have, the one you are
 * reading, and the pages that mention it. The third is the one that makes this
 * a wiki rather than a folder of documents: a page you never linked *from* can
 * still be found from the page you linked *to*, which is how a set of notes
 * turns into something you can navigate a year later.
 */
export function NotesPage({
  initialPageId,
  onOpenItem,
}: {
  initialPageId?: string | null;
  /** Go to a task, from a page about it. */
  onOpenItem?: (itemId: string) => void;
}) {
  const pages = usePages();
  const create = useCreatePage();
  const rename = useRenamePage();
  const remove = useDeletePage();

  const [openId, setOpenId] = useState<string | null>(initialPageId ?? null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState('');
  const [showMarked, setShowMarked] = useState(false);

  const all = useMemo(() => pages.data ?? [], [pages.data]);
  const pairs = useItemPages();
  const appliedTo = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pair of pairs.data ?? []) {
      counts.set(pair.pageId, (counts.get(pair.pageId) ?? 0) + 1);
    }
    return counts;
  }, [pairs.data]);
  // Which page is open is derived, not synchronised: the state holds what the
  // person chose, and the list decides what that means now. Nothing chosen, or
  // a page deleted from under them, falls back to the first one — without an
  // effect that would render once against a page that is gone.
  const open = all.find((page) => page.id === openId) ?? all[0] ?? null;

  const openPage = (pageId: string) => {
    setOpenId(pageId);
    setDraftTitle(null);
    setShowMarked(false);
  };

  const shown = useMemo(() => {
    const key = titleKey(filter);
    return key === '' ? all : all.filter((page) => titleKey(page.title).includes(key));
  }, [all, filter]);

  const others = useMemo(() => all.filter((page) => page.id !== open?.id), [all, open?.id]);
  const complaint = draftTitle === null ? null : checkTitle(draftTitle, others);

  const add = () => {
    // A new page is named for what it will be about; until then it is what
    // every product calls it, made unique so the name can never collide.
    const taken = new Set(all.map((page) => titleKey(page.title)));
    let title = UNTITLED;
    for (let n = 2; taken.has(titleKey(title)); n += 1) title = `${UNTITLED} ${n}`;

    create.mutate(
      { title, position: between(all.at(-1)?.position ?? null, null) },
      {
        onSuccess: (page) => {
          setOpenId(page.id);
          setDraftTitle(page.title);
          setShowMarked(false);
          announce(`${page.title} created`);
        },
      },
    );
  };

  const commitTitle = () => {
    if (open === null || draftTitle === null) return;
    const trimmed = draftTitle.trim();
    if (complaint !== null || trimmed === open.title) {
      setDraftTitle(null);
      return;
    }
    rename.mutate(
      { id: open.id, title: trimmed },
      {
        onSuccess: (page) => {
          setDraftTitle(null);
          announce(`Renamed to ${page.title}`);
        },
      },
    );
  };

  const failure = pages.error ?? create.error ?? rename.error ?? remove.error;

  return (
    <div className="flex h-full min-h-0">
      <aside
        aria-label="Pages"
        className="flex w-64 shrink-0 flex-col gap-2 border-r border-stroke-subtle p-3"
      >
        <div className="flex items-center gap-2">
          <Input
            aria-label="Find a page"
            placeholder="Find a page"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <IconButton label="New page" icon={<Add20Regular />} onClick={add} />
        </div>

        <button
          type="button"
          aria-current={showMarked ? 'true' : undefined}
          onClick={() => setShowMarked(true)}
          className={[
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-body',
            showMarked ? 'bg-card-hover text-fg' : 'text-fg-secondary hover:bg-card-hover',
          ].join(' ')}
        >
          <TagMultiple20Regular aria-hidden="true" />
          Marked lines
        </button>

        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {shown.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                aria-label={`Open ${page.title}`}
                aria-current={!showMarked && page.id === open?.id ? 'true' : undefined}
                onClick={() => {
                  setOpenId(page.id);
                  setDraftTitle(null);
                  setShowMarked(false);
                }}
                className={[
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body',
                  !showMarked && page.id === open?.id
                    ? 'bg-card-hover text-fg'
                    : 'text-fg-secondary',
                ].join(' ')}
              >
                <span className="min-w-0 flex-1 truncate">{page.title}</span>
                {(appliedTo.get(page.id) ?? 0) > 0 && (
                  <span
                    data-page-applied={appliedTo.get(page.id)}
                    title={`Applied to ${appliedTo.get(page.id)} ${appliedTo.get(page.id) === 1 ? 'task' : 'tasks'}`}
                    className="flex shrink-0 items-center gap-0.5 text-caption text-fg-tertiary"
                  >
                    <TaskListSquareLtr16Regular aria-hidden="true" />
                    {appliedTo.get(page.id)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto xl:overflow-hidden">
        {failure !== null && (
          <div className="p-6 pb-0">
            <InfoBar severity="danger" title="That did not work">
              {describeError(failure)}
            </InfoBar>
          </div>
        )}

        {showMarked ? (
          <MarkedLines
            onOpen={(line) => {
              if (line.ownerKind === 'item') {
                onOpenItem?.(line.ownerId);
                return;
              }
              setOpenId(line.ownerId);
              setDraftTitle(null);
              setShowMarked(false);
            }}
          />
        ) : open === null ? (
          <div className="flex flex-col gap-4 p-6">
            {/* The screen keeps a heading even with nothing in it: every other
                destination has one, and a page that loses its outline when it
                is empty is a page a screen reader cannot place. */}
            <h1 className="text-title font-semibold text-fg">Notes</h1>
            <EmptyState
              title="No pages yet"
              description="A page is somewhere to think. Write in one, and link to another by typing two square brackets."
              action={
                <Button icon={<Add20Regular />} onClick={add}>
                  New page
                </Button>
              }
            />
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-4 p-6 xl:overflow-y-auto">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {draftTitle === null ? (
                    <h1 className="truncate text-title font-semibold text-fg">{open.title}</h1>
                  ) : (
                    <Input
                      autoFocus
                      aria-label="Page name"
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={commitTitle}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitTitle();
                        } else if (event.key === 'Escape') {
                          setDraftTitle(null);
                        }
                      }}
                    />
                  )}
                  {complaint !== null && (
                    <p role="alert" className="mt-1 text-caption text-danger">
                      {complaint}
                    </p>
                  )}
                </div>
                <IconButton
                  label={`Rename ${open.title}`}
                  icon={<Rename20Regular />}
                  onClick={() => setDraftTitle(open.title)}
                />
                <IconButton
                  label={`Delete ${open.title}`}
                  icon={<Delete20Regular />}
                  onClick={() => setConfirming(true)}
                />
              </div>

              <AppliedTasks
                key={`tasks-${open.id}`}
                pageId={open.id}
                pageTitle={open.title}
                onOpenItem={onOpenItem}
              />

              {/* Keyed on the page: opening another one is a different document,
                and an editor that kept its content would show the last one. */}
              <Suspense fallback={<Skeleton />}>
                <Editor
                  key={open.id}
                  ownerKind="page"
                  ownerId={open.id}
                  label={`Text of ${open.title}`}
                  subject={open.title}
                  fill
                  onOpenPage={openPage}
                  onOpenItem={onOpenItem}
                />
              </Suspense>
            </div>

            <aside
              aria-label="What this page is connected to"
              className="shrink-0 border-t border-stroke-subtle p-4 xl:w-80 xl:overflow-y-auto xl:border-t-0 xl:border-l"
            >
              <Connections page={open} onOpenPage={openPage} onOpenItem={onOpenItem} />
            </aside>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming && open !== null}
        title={`Delete ${open?.title ?? 'this page'}?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          if (open === null) return;
          const name = open.title;
          remove.mutate(open.id, {
            onSuccess: () => {
              setConfirming(false);
              setOpenId(null);
              announce(`${name} deleted`);
            },
          });
        }}
      >
        The page and what is written in it are removed. Links to it stay where they are, and point
        at nothing until a page of that name exists again.
      </ConfirmDialog>
    </div>
  );
}

export type { Page };
