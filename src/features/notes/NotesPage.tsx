import {
  Add20Regular,
  Delete20Regular,
  Link20Regular,
  Rename20Regular,
} from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useBacklinks, useCreatePage, useDeletePage, usePages, useRenamePage } from '@/data/hooks';
import { between } from '@/domain/ordering';
import { checkTitle, titleKey, UNTITLED, type Page } from '@/domain/page';
import { Editor } from '@/features/editor/Editor';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
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
export function NotesPage({ initialPageId }: { initialPageId?: string | null }) {
  const pages = usePages();
  const create = useCreatePage();
  const rename = useRenamePage();
  const remove = useDeletePage();

  const [openId, setOpenId] = useState<string | null>(initialPageId ?? null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState('');

  const all = useMemo(() => pages.data ?? [], [pages.data]);
  // Which page is open is derived, not synchronised: the state holds what the
  // person chose, and the list decides what that means now. Nothing chosen, or
  // a page deleted from under them, falls back to the first one — without an
  // effect that would render once against a page that is gone.
  const open = all.find((page) => page.id === openId) ?? all[0] ?? null;
  const backlinks = useBacklinks(open?.id ?? null);

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

        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {shown.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                aria-label={`Open ${page.title}`}
                aria-current={page.id === open?.id ? 'true' : undefined}
                onClick={() => {
                  setOpenId(page.id);
                  setDraftTitle(null);
                }}
                className={[
                  'w-full truncate rounded-md px-2 py-1.5 text-left text-body',
                  page.id === open?.id ? 'bg-card-hover text-fg' : 'text-fg-secondary',
                ].join(' ')}
              >
                {page.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {failure !== null && (
          <div className="p-6 pb-0">
            <InfoBar severity="danger" title="That did not work">
              {describeError(failure)}
            </InfoBar>
          </div>
        )}

        {open === null ? (
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
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
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

            {/* Keyed on the page: opening another one is a different document,
                and an editor that kept its content would show the last one. */}
            <Editor key={open.id} ownerKind="page" ownerId={open.id} />

            <section aria-label="Linked from" className="mt-4 border-t border-stroke-subtle pt-4">
              <h2 className="mb-2 flex items-center gap-2 text-caption font-semibold text-fg-tertiary uppercase">
                <Link20Regular aria-hidden="true" />
                Linked from
              </h2>
              {(backlinks.data ?? []).length === 0 ? (
                <p className="text-body text-fg-tertiary">
                  Nothing points here yet. Type <code>[[{open.title}]]</code> in another page.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {(backlinks.data ?? []).map((entry) => (
                    <li key={`${entry.ownerKind}:${entry.ownerId}`}>
                      {entry.ownerKind === 'page' ? (
                        <button
                          type="button"
                          aria-label={`Open ${entry.title}`}
                          onClick={() => {
                            setOpenId(entry.ownerId);
                            setDraftTitle(null);
                          }}
                          className="w-full truncate rounded-md px-2 py-1 text-left text-body text-accent hover:bg-card-hover"
                        >
                          {entry.title}
                        </button>
                      ) : (
                        <p className="flex items-baseline gap-2 px-2 py-1">
                          <span className="text-caption text-fg-tertiary">
                            {entry.ownerKind === 'item' ? 'Task' : 'Event'}
                          </span>
                          <span className="truncate text-body text-fg">{entry.title}</span>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
