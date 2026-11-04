import { Notebook16Regular } from '@fluentui/react-icons';

import type { Page } from '@/domain/page';

/**
 * A task saying which note is applied to it: the note's name, one press from the note.
 * Two or more say how many, and all their names are in the tooltip.
 */
export function NotesChip({
  notes,
  onOpenPage,
}: {
  notes: readonly Page[];
  onOpenPage?: ((pageId: string) => void) | undefined;
}) {
  const first = notes[0];
  if (first === undefined) return null;
  const names = notes.map((note) => note.title).join(', ');
  return (
    <button
      type="button"
      data-task-note={first.id}
      aria-label={`Open the note ${first.title}${notes.length > 1 ? `, one of ${notes.length}: ${names}` : ''}`}
      title={notes.length > 1 ? names : `Note: ${first.title}`}
      disabled={onOpenPage === undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpenPage?.(first.id);
      }}
      className="inline-flex max-w-44 shrink-0 items-center gap-1 rounded-sm border border-accent/30 bg-accent-subtle px-1.5 py-0.5 text-caption font-semibold text-accent enabled:hover:underline"
    >
      <Notebook16Regular aria-hidden="true" className="shrink-0" />
      <span className="truncate">{notes.length > 1 ? `${notes.length} notes` : first.title}</span>
    </button>
  );
}
