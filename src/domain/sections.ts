/**
 * A notebook in sections, as OneNote keeps one (migration 022).
 *
 * A section is a named, coloured group of pages. A page is in one section or in
 * none, and none is Quick notes: where a page that was never filed is, and where a
 * page goes back to when its section is deleted. Quick notes is not a row, so it can
 * never be renamed, recoloured or deleted.
 *
 * Pure: no I/O, no React, no host.
 */

import type { ColorId } from './colors';
import { between, sortByKey } from './ordering';

export interface Section {
  id: string;
  name: string;
  color: ColorId | null;
  position: string;
}

/** The name Quick notes is shown by. */
export const QUICK_NOTES = 'Quick notes';

export const LONGEST_SECTION_NAME = 60;

export type SectionNameCheck =
  { status: 'ok'; name: string } | { status: 'invalid'; reason: string };

export function checkSectionName(
  name: string,
  sections: readonly Section[],
  except: string | null = null,
): SectionNameCheck {
  const clean = name.trim();
  if (clean === '') return { status: 'invalid', reason: 'A section needs a name.' };
  if ([...clean].length > LONGEST_SECTION_NAME) {
    return { status: 'invalid', reason: `Keep it to ${LONGEST_SECTION_NAME} characters.` };
  }
  if (clean.toLowerCase() === QUICK_NOTES.toLowerCase()) {
    return {
      status: 'invalid',
      reason: 'Quick notes is already there, for pages with no section.',
    };
  }
  const taken = sections.some(
    (section) => section.id !== except && section.name.toLowerCase() === clean.toLowerCase(),
  );
  if (taken) return { status: 'invalid', reason: 'There is already a section with that name.' };
  return { status: 'ok', name: clean };
}

export function orderedSections(sections: readonly Section[]): Section[] {
  return sortByKey(sections, (section) => section.position);
}

/** Where a new section goes: after the last one. */
export function positionForNewSection(sections: readonly Section[]): string {
  return between(orderedSections(sections).at(-1)?.position ?? null, null);
}

/** The pages in a section, or in Quick notes for null, in their order. */
export function pagesIn<T extends { sectionId: string | null }>(
  pages: readonly T[],
  sectionId: string | null,
): T[] {
  return pages.filter((page) => page.sectionId === sectionId);
}

/** How many pages each section holds, Quick notes under the empty key. */
export function pageCounts(pages: readonly { sectionId: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const key = page.sectionId ?? '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
