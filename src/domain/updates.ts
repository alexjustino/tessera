/**
 * The update check, in words (ADR-062).
 *
 * The host asks GitHub; this says what came of it. Pure, so the sentences a
 * person reads are tested without a network.
 */

import { describeAge } from './settings';

/** A newer release, as the host reports it. */
export interface UpdateFound {
  version: string;
  /** The release notes, as published. */
  notes: string | null;
}

export type UpdateState =
  | { kind: 'off' }
  | { kind: 'checking' }
  | { kind: 'newest'; checkedAt: string }
  | { kind: 'available'; found: UpdateFound; checkedAt: string }
  | { kind: 'unreachable'; checkedAt: string | null };

/** The sentence under the Updates row in Settings. */
export function describeUpdate(state: UpdateState, now: string): string {
  switch (state.kind) {
    case 'off':
      return 'Off. Tessera makes no request to the network.';
    case 'checking':
      return 'Asking GitHub…';
    case 'newest':
      return `This is the newest release. Checked ${describeAge(state.checkedAt, now)}.`;
    case 'available':
      return `Tessera ${state.found.version} is ready to install.`;
    case 'unreachable':
      return state.checkedAt === null
        ? 'GitHub could not be reached. Tessera asks again tomorrow.'
        : `GitHub could not be reached. The last answer came ${describeAge(state.checkedAt, now)}.`;
  }
}

/** How long one entry of the notes may be in the bar. */
const ENTRY_LIMIT = 160;

const HEADING = /^#+\s*/;
const ITEM = /^[-*]\s+/;

function plain(text: string): string {
  const bare = text
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return bare.length > ENTRY_LIMIT ? `${bare.slice(0, ENTRY_LIMIT - 1).trimEnd()}…` : bare;
}

/**
 * The first things the release notes say, as whole sentences: a paragraph or a
 * list item wrapped over several lines is one entry, a heading is an entry of
 * its own, and Markdown marks are dropped. Enough to say what changed, short
 * enough for a bar.
 */
export function notesPreview(notes: string | null, entries = 3): string[] {
  if (notes === null) return [];
  const found: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current !== null) {
      const entry = plain(current);
      if (entry.length > 0) found.push(entry);
    }
    current = null;
  };
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) {
      flush();
    } else if (HEADING.test(line)) {
      flush();
      current = line.replace(HEADING, '');
      flush();
    } else if (ITEM.test(line)) {
      flush();
      current = line.replace(ITEM, '');
    } else {
      current = current === null ? line : `${current} ${line}`;
    }
  }
  flush();
  return found.slice(0, entries);
}
