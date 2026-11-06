import { useCalendars, useCreateTimeBlock } from '@/data/hooks';
import { describeError } from '@/data/errors';
import { isCompleted, type Item } from '@/domain/item';
import { systemZone } from '@/domain/schedule';
import { describeDay } from '@/features/reports/format';
import { EmptyState } from '@/ui/EmptyState';
import { InfoBar } from '@/ui/InfoBar';
import { Modal } from '@/ui/Modal';

/** An hour of the week a person has pressed. */
export interface HourChoice {
  day: string;
  startMinute: number;
  minutes: number;
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** Set a free hour aside for a task. It goes on the calendar, as a block does from there. */
export function ReserveHour({
  hour,
  items,
  onClose,
}: {
  hour: HourChoice | null;
  items: readonly Item[];
  onClose: () => void;
}) {
  const calendars = useCalendars();
  const reserve = useCreateTimeBlock();
  const open = items.filter((item) => !isCompleted(item) && !item.isMilestone);

  const heading =
    hour === null
      ? ''
      : `Set ${describeDay(hour.day)}, ${clock(hour.startMinute)} aside for a task`;

  const choose = (item: Item) => {
    if (hour === null) return;
    const startsAt = new Date(`${hour.day}T${clock(hour.startMinute)}:00`);
    reserve.mutate(
      {
        itemId: item.id,
        calendarId: calendars.data?.[0]?.id ?? 'personal',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + hour.minutes * 60_000).toISOString(),
        tz: systemZone(),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal open={hour !== null} onClose={onClose} label={heading}>
      <h2 className="mb-3 text-body-lg font-semibold text-fg">{heading}</h2>
      {reserve.error !== null && (
        <InfoBar severity="danger" title="That hour was not set aside">
          {describeError(reserve.error)}
        </InfoBar>
      )}
      {open.length === 0 ? (
        <EmptyState
          title="No open tasks"
          description="Add a task first, and come back to this hour."
        />
      ) : (
        <ul aria-label="Open tasks" className="flex max-h-96 flex-col overflow-y-auto">
          {open.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={reserve.isPending}
                onClick={() => choose(item)}
                className="w-full truncate rounded-md px-2 py-2 text-left text-body text-fg hover:bg-card-hover"
              >
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
