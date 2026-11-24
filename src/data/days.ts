import { invoke } from '@tauri-apps/api/core';

import { between } from '@/domain/ordering';
import { plainText, type Block, type DocNode } from '@/domain/document';
import { titleKey } from '@/domain/page';
import { JOURNAL_SECTION, journalTitle } from '@/domain/ritual';

import { applyBlocks, listBlocks } from './blocks';
import { createPage, createSection, filePage, listPages, listSections } from './pages';

/** One day of the ritual: when it was planned and closed, and what it came to. */
export interface DayReview {
  day: string;
  plannedAt: string | null;
  closedAt: string | null;
  score: number | null;
  done: number;
  carried: number;
  trackedMinutes: number;
  note: string | null;
}

interface RawDayReview {
  day: string;
  planned_at: string | null;
  closed_at: string | null;
  score: number | null;
  done: number;
  carried: number;
  tracked_minutes: number;
  note: string | null;
}

const toReview = (raw: RawDayReview): DayReview => ({
  day: raw.day,
  plannedAt: raw.planned_at,
  closedAt: raw.closed_at,
  score: raw.score,
  done: raw.done,
  carried: raw.carried,
  trackedMinutes: raw.tracked_minutes,
  note: raw.note,
});

export async function listDayReviews(from: string): Promise<DayReview[]> {
  return (await invoke<RawDayReview[]>('day_reviews_list', { from })).map(toReview);
}

export async function markPlanned(day: string): Promise<DayReview> {
  return toReview(await invoke<RawDayReview>('day_planned', { day }));
}

export async function closeDay(
  day: string,
  close: {
    score: number | null;
    done: number;
    carried: number;
    trackedMinutes: number;
    note: string;
  },
): Promise<DayReview> {
  return toReview(
    await invoke<RawDayReview>('day_close', {
      day,
      close: {
        score: close.score,
        done: close.done,
        carried: close.carried,
        tracked_minutes: close.trackedMinutes,
        note: close.note,
      },
    }),
  );
}

/**
 * Add a day's entry to the end of its month's journal page, in the Journal section of
 * Notes, making the section and the page the first time.
 */
export async function appendToJournal(day: string, nodes: readonly DocNode[]): Promise<string> {
  const sections = await listSections();
  const journal =
    sections.find((section) => section.name.toLowerCase() === JOURNAL_SECTION.toLowerCase()) ??
    (await createSection({
      name: JOURNAL_SECTION,
      color: 'gray',
      position: between(sections.at(-1)?.position ?? null, null),
    }));

  const title = journalTitle(day);
  const pages = await listPages();
  let page = pages.find((candidate) => titleKey(candidate.title) === titleKey(title));
  if (page === undefined) {
    page = await createPage(title, between(pages.at(-1)?.position ?? null, null));
  }
  if (page.sectionId !== journal.id) await filePage(page.id, journal.id);

  const existing = await listBlocks('page', page.id);
  let last = existing.reduce<string | null>(
    (highest, block) => (highest === null || block.position > highest ? block.position : highest),
    null,
  );
  const creates = nodes.map((node) => {
    last = between(last, null);
    return { id: crypto.randomUUID(), type: node.type, position: last, content: node };
  });
  const all: Block[] = [...existing, ...creates];
  await applyBlocks('page', page.id, { creates, updates: [], deletes: [] }, plainText(all));
  return page.id;
}
