import { CalendarLtr16Regular } from '@fluentui/react-icons';

import { useEventPages } from '@/data/hooks';

function whenOf(instant: string): string {
  return new Date(instant).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Under a meeting's notes: which meeting, and when. Nothing for any other page. */
export function MeetingLine({ pageId }: { pageId: string }) {
  const pairs = useEventPages();
  const mine = (pairs.data ?? []).filter((pair) => pair.pageId === pageId);
  if (mine.length === 0) return null;

  return (
    <ul aria-label="Meetings" data-testid="meeting-line" className="flex flex-col gap-0.5">
      {mine.map((pair) => (
        <li
          key={`${pair.eventId}@${pair.originalStart}`}
          className="flex items-center gap-2 text-caption text-fg-secondary"
        >
          <CalendarLtr16Regular aria-hidden="true" className="shrink-0" />
          <span>
            Notes of <span className="font-semibold text-fg">{pair.eventTitle}</span>,{' '}
            {whenOf(pair.originalStart)}
          </span>
        </li>
      ))}
    </ul>
  );
}
