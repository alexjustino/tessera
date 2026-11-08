import {
  Add16Regular,
  Add20Regular,
  Delete20Regular,
  Edit16Regular,
  Rename20Regular,
  TagMultiple20Regular,
  TaskListSquareLtr16Regular,
} from '@fluentui/react-icons';
import { Suspense, useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import {
  useCreatePage,
  useDeletePage,
  useFilePage,
  useItemPages,
  usePages,
  useRenamePage,
  useSections,
} from '@/data/hooks';
import { SWATCH } from '@/domain/colors';
import { orderedSections, pageCounts, pagesIn, QUICK_NOTES, type Section } from '@/domain/sections';
import { between } from '@/domain/ordering';
import { checkTitle, titleKey, UNTITLED, type Page } from '@/domain/page';
import { Editor } from '@/app/lazyPages';
import { AppliedTasks } from './AppliedTasks';
import { MeetingLine } from './MeetingLine';
import { Connections } from './Connections';
import { MarkedLines } from './MarkedLines';
import { SectionDialog } from './SectionDialog';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
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
  const sections = useSections();
  const filePage = useFilePage();
  const create = useCreatePage();
  const rename = useRenamePage();
  const remove = useDeletePage();

  const [openId, setOpenId] = useState<string | null>(initialPageId ?? null);
  /** The line Marked lines was pressed for, to go to once its page is open. */
  const [reveal, setReveal] = useState<{ blockId: string; text: string } | null>(null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [filter, setFilter] = useState('');
  const [showMarked, setShowMarked] = useState(false);
  /** The section chosen in the list; undefined follows the open page's. */
  const [chosenSection, setChosenSection] = useState<string | null | undefined>(undefined);
  /** The section being made (null) or changed, while its dialog is open. */
  const [sectionDialog, setSectionDialog] = useState<{ editing: Section | null } | null>(null);

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
  const ordered = useMemo(() => orderedSections(sections.data ?? []), [sections.data]);
  const counts = useMemo(() => pageCounts(all), [all]);
  const chosen = all.find((page) => page.id === openId);
  const currentSection = chosenSection !== undefined ? chosenSection : (chosen?.sectionId ?? null);
  const open =
    chosen !== undefined && (chosenSection === undefined || chosen.sectionId === currentSection)
      ? chosen
      : (pagesIn(all, currentSection)[0] ?? null);

  const openPage = (pageId: string) => {
    setOpenId(pageId);
    setDraftTitle(null);
    setShowMarked(false);
  };

  const shown = useMemo(() => {
    const key = titleKey(filter);
    // Finding looks in every section; otherwise the list is the section's.
    return key === ''
      ? pagesIn(all, currentSection)
      : all.filter((page) => titleKey(page.title).includes(key));
  }, [all, filter, currentSection]);

  const sectionColorOf = (sectionId: string | null) => {
    const color = ordered.find((section) => section.id === sectionId)?.color;
    return color ? SWATCH[color] : null;
  };

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
          // A new page is made where the person is: in the section on screen.
          if (currentSection !== null) {
            filePage.mutate({ id: page.id, sectionId: currentSection });
          }
          setChosenSection(currentSection);
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

        <div className="flex items-center justify-between px-2 pt-1">
          <h2 className="text-caption font-semibold text-fg-tertiary uppercase">Sections</h2>
          <IconButton
            label="New section"
            icon={<Add16Regular />}
            onClick={() => setSectionDialog({ editing: null })}
          />
        </div>
        <ul aria-label="Sections" className="flex flex-col gap-0.5">
          {[null, ...ordered].map((section) => {
            const id = section?.id ?? null;
            const selected = !showMarked && filter === '' && id === currentSection;
            const name = section?.name ?? QUICK_NOTES;
            const count = counts.get(id ?? '') ?? 0;
            return (
              <li key={id ?? 'quick'} className="group flex items-center gap-1">
                <button
                  type="button"
                  data-section={id ?? 'quick'}
                  aria-current={selected ? 'true' : undefined}
                  aria-label={`${name}, ${count} ${count === 1 ? 'page' : 'pages'}`}
                  onClick={() => {
                    setChosenSection(id);
                    setOpenId(pagesIn(all, id)[0]?.id ?? null);
                    setFilter('');
                    setDraftTitle(null);
                    setShowMarked(false);
                  }}
                  className={[
                    'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-body',
                    selected
                      ? 'bg-card-hover font-semibold text-fg'
                      : 'text-fg-secondary hover:bg-card-hover',
                  ].join(' ')}
                >
                  <span
                    aria-hidden="true"
                    className={[
                      'h-4 w-1.5 shrink-0 rounded-full',
                      section?.color
                        ? SWATCH[section.color]
                        : 'border border-dashed border-stroke-strong',
                    ].join(' ')}
                  />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span aria-hidden="true" className="text-caption tabular-nums text-fg-tertiary">
                    {count}
                  </span>
                </button>
                {section !== null && (
                  <IconButton
                    label={`Edit ${section.name}`}
                    icon={<Edit16Regular />}
                    onClick={() => setSectionDialog({ editing: section })}
                  />
                )}
              </li>
            );
          })}
        </ul>

        <h2 className="px-2 pt-2 text-caption font-semibold text-fg-tertiary uppercase">
          {filter === '' ? 'Pages' : 'Found'}
        </h2>
        <ul aria-label="Pages" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {shown.length === 0 && filter === '' && (
            <li className="px-2 py-1 text-caption text-fg-tertiary">
              No pages here yet. The + above makes one.
            </li>
          )}
          {shown.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                aria-label={`Open ${page.title}`}
                aria-current={!showMarked && page.id === open?.id ? 'true' : undefined}
                onClick={() => {
                  setOpenId(page.id);
                  setChosenSection(page.sectionId);
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
                {filter !== '' && (
                  <span
                    aria-hidden="true"
                    className={[
                      'size-2 shrink-0 rounded-full',
                      sectionColorOf(page.sectionId) ?? 'border border-stroke-strong',
                    ].join(' ')}
                  />
                )}
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
              setReveal({ blockId: line.blockId, text: line.text });
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
                <label className="flex items-center gap-1 text-caption text-fg-secondary">
                  <span className="sr-only">Section of {open.title}</span>
                  <Select
                    aria-label={`Section of ${open.title}`}
                    value={open.sectionId ?? ''}
                    className="w-40"
                    onChange={(event) => {
                      const target = event.target.value === '' ? null : event.target.value;
                      filePage.mutate(
                        { id: open.id, sectionId: target },
                        {
                          onSuccess: () => {
                            setChosenSection(target);
                            announce(
                              `Moved ${open.title} to ${ordered.find((one) => one.id === target)?.name ?? QUICK_NOTES}`,
                            );
                          },
                        },
                      );
                    }}
                  >
                    <option value="">{QUICK_NOTES}</option>
                    {ordered.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </Select>
                </label>
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

              <MeetingLine pageId={open.id} />

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
                  reveal={reveal}
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
      {sectionDialog !== null && (
        <SectionDialog
          editing={sectionDialog.editing}
          pagesInIt={
            sectionDialog.editing === null ? 0 : (counts.get(sectionDialog.editing.id) ?? 0)
          }
          onClose={() => setSectionDialog(null)}
          onSaved={(section) => {
            setSectionDialog(null);
            setChosenSection(section.id);
            setShowMarked(false);
          }}
          onDeleted={() => {
            setSectionDialog(null);
            setChosenSection(null);
          }}
        />
      )}
    </div>
  );
}

export type { Page };
