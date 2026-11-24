import { invoke } from '@tauri-apps/api/core';

import { diff, plainText, type Block } from '@/domain/document';
import { notesTemplate, type Meeting } from '@/domain/meetingNotes';

import { applyBlocks } from './blocks';

/** A page paired with one occurrence of a meeting. */
export interface EventPage {
  eventId: string;
  originalStart: string;
  pageId: string;
  eventTitle: string;
}

interface RawEventPage {
  event_id: string;
  original_start: string;
  page_id: string;
  event_title: string;
}

export async function listEventPages(): Promise<EventPage[]> {
  return (await invoke<RawEventPage[]>('event_pages_list')).map((raw) => ({
    eventId: raw.event_id,
    originalStart: raw.original_start,
    pageId: raw.page_id,
    eventTitle: raw.event_title,
  }));
}

const newId = () => crypto.randomUUID();

/**
 * The page of one occurrence of a meeting: made, paired and given its opening lines
 * the first time, found every time after. Returns the page's id.
 */
export async function openMeetingNotes(input: {
  eventId: string;
  originalStart: string;
  title: string;
  position: string;
  meeting: Meeting;
  zone: string;
}): Promise<string> {
  const opened = await invoke<{ page: { id: string }; created: boolean }>('meeting_notes_open', {
    eventId: input.eventId,
    originalStart: input.originalStart,
    title: input.title,
    position: input.position,
  });
  if (opened.created) {
    const changes = diff([], notesTemplate(input.meeting, input.zone), newId);
    const blocks: Block[] = changes.creates.map((create) => ({ ...create }));
    await applyBlocks('page', opened.page.id, changes, plainText(blocks));
  }
  return opened.page.id;
}
