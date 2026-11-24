import {
  ArrowLeft20Regular,
  ArrowRight20Regular,
  BookOpen20Regular,
  Search20Regular,
} from '@fluentui/react-icons';
import { useCallback, useState } from 'react';

import {
  GUIDE,
  searchGuide,
  type GuideChapter,
  type GuidePlace,
  type GuideSection,
} from '@/domain/guide';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Input } from '@/ui/Input';
import { Kbd } from '@/ui/Kbd';
import { Page } from '@/ui/Page';

import { GuideScene } from './GuideScene';

/** Where the guide opens, and the section to bring into view. */
export interface GuideTarget {
  chapterId: string;
  sectionId?: string;
}

function Section({
  section,
  onTry,
  focused,
}: {
  section: GuideSection;
  onTry: (place: GuidePlace) => void;
  focused: boolean;
}) {
  const scrollTo = useCallback(
    (element: HTMLElement | null) => {
      if (focused) element?.scrollIntoView({ block: 'start' });
    },
    [focused],
  );
  return (
    <section
      ref={scrollTo}
      id={`guide-${section.id}`}
      data-section={section.id}
      aria-labelledby={`guide-${section.id}-title`}
      className="grid gap-5 border-t border-stroke-subtle pt-6 first:border-t-0 first:pt-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <h3 id={`guide-${section.id}-title`} className="text-body-lg font-semibold text-fg">
          {section.title}
        </h3>
        {section.body.map((paragraph) => (
          <p key={paragraph.slice(0, 32)} className="max-w-prose text-body text-fg">
            {paragraph}
          </p>
        ))}
        {section.points && (
          <ul className="flex max-w-prose list-disc flex-col gap-1 pl-5 text-body text-fg">
            {section.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        )}
        {section.keys && (
          <table className="max-w-prose text-body">
            <caption className="sr-only">Keys and what they do</caption>
            <tbody>
              {section.keys.map((key) => (
                <tr key={key.keys} className="border-b border-stroke-subtle last:border-b-0">
                  <th scope="row" className="py-2 pr-6 text-left font-normal">
                    <span className="flex flex-wrap gap-1">
                      {key.keys.split(' / ').map((chord) => (
                        <Kbd key={chord}>{chord}</Kbd>
                      ))}
                    </span>
                  </th>
                  <td className="py-2 text-fg-secondary">{key.does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {section.tryIt && (
          <div>
            <Button
              appearance="standard"
              icon={<ArrowRight20Regular />}
              onClick={() => onTry(section.tryIt!.place)}
            >
              {section.tryIt.label}
            </Button>
          </div>
        )}
      </div>
      {section.scene && <GuideScene id={section.scene} />}
    </section>
  );
}

function Chapter({
  chapter,
  number,
  focusSection,
  onTry,
}: {
  chapter: GuideChapter;
  number: number;
  focusSection: string | undefined;
  onTry: (place: GuidePlace) => void;
}) {
  return (
    <article aria-labelledby="guide-chapter-title" className="flex flex-col gap-6">
      <header>
        <p className="text-caption font-semibold uppercase text-accent">Chapter {number}</p>
        <h2 id="guide-chapter-title" className="text-title font-semibold text-fg">
          {chapter.title}
        </h2>
        <p className="mt-1 text-body-lg text-fg-secondary">{chapter.summary}</p>
      </header>
      {chapter.sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          onTry={onTry}
          focused={section.id === focusSection}
        />
      ))}
    </article>
  );
}

/**
 * The User Guide (ADR-064): every chapter of what Tessera does, with a scene that
 * shows it and a way to go and try it. F1 opens it from anywhere in the window.
 */
export function GuidePage({
  target = null,
  onNavigate,
}: {
  target?: GuideTarget | null;
  onNavigate: (place: GuidePlace) => void;
}) {
  const [chapterId, setChapterId] = useState(target?.chapterId ?? GUIDE[0]!.id);
  const [focusSection, setFocusSection] = useState(target?.sectionId);
  const [query, setQuery] = useState('');
  const index = Math.max(
    0,
    GUIDE.findIndex((chapter) => chapter.id === chapterId),
  );
  const chapter = GUIDE[index]!;
  const hits = searchGuide(query);
  const searching = query.trim() !== '';

  const open = (id: string, sectionId?: string) => {
    setQuery('');
    setChapterId(id);
    setFocusSection(sectionId);
  };

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-fg">Guide</h1>
          <p className="mt-1 text-body text-fg-secondary">
            Everything Tessera does, and how. Press <Kbd>F1</Kbd> to come back here.
          </p>
        </div>
        <label className="relative w-full max-w-sm">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-secondary">
            <Search20Regular />
          </span>
          <Input
            type="search"
            aria-label="Search the guide"
            placeholder="Search the guide"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full pl-10"
          />
        </label>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <nav aria-label="Chapters" className="shrink-0 lg:sticky lg:top-6 lg:w-64">
          <ol className="flex flex-col gap-0.5">
            {GUIDE.map((entry, number) => (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-current={!searching && entry.id === chapter.id ? 'page' : undefined}
                  onClick={() => open(entry.id)}
                  className={[
                    'flex w-full items-baseline gap-3 rounded-md px-3 py-2 text-left text-body',
                    'transition-colors duration-100 ease-easy',
                    !searching && entry.id === chapter.id
                      ? 'bg-card-active font-semibold text-fg'
                      : 'text-fg-secondary hover:bg-card-hover',
                  ].join(' ')}
                >
                  <span className="w-5 shrink-0 text-right tabular-nums text-caption">
                    {number + 1}
                  </span>
                  {entry.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 max-w-6xl flex-1 flex-col gap-6">
          {searching ? (
            hits.length === 0 ? (
              <EmptyState
                icon={<BookOpen20Regular />}
                title={`Nothing in the guide matches “${query.trim()}”`}
                description="Try fewer words, or pick a chapter on the left."
              />
            ) : (
              <section aria-label="Search results" className="flex flex-col gap-2">
                <p className="text-caption text-fg-secondary" aria-live="polite">
                  {hits.length === 1 ? '1 section' : `${hits.length} sections`}
                </p>
                <ul className="flex flex-col gap-1">
                  {hits.map((hit) => (
                    <li key={`${hit.chapter.id}-${hit.section.id}`}>
                      <button
                        type="button"
                        onClick={() => open(hit.chapter.id, hit.section.id)}
                        className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-card-hover"
                      >
                        <span className="text-caption text-fg-secondary">{hit.chapter.title}</span>
                        <span className="text-body font-semibold text-fg">{hit.section.title}</span>
                        <span className="line-clamp-1 text-caption text-fg-secondary">
                          {hit.section.body[0]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          ) : (
            <>
              <Chapter
                key={chapter.id}
                chapter={chapter}
                number={index + 1}
                focusSection={focusSection}
                onTry={onNavigate}
              />
              <nav aria-label="Next and previous chapter" className="flex justify-between gap-2">
                {index > 0 ? (
                  <Button
                    appearance="subtle"
                    icon={<ArrowLeft20Regular />}
                    onClick={() => open(GUIDE[index - 1]!.id)}
                  >
                    {GUIDE[index - 1]!.title}
                  </Button>
                ) : (
                  <span />
                )}
                {index < GUIDE.length - 1 && (
                  <Button
                    appearance="standard"
                    icon={<ArrowRight20Regular />}
                    onClick={() => open(GUIDE[index + 1]!.id)}
                  >
                    {GUIDE[index + 1]!.title}
                  </Button>
                )}
              </nav>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
