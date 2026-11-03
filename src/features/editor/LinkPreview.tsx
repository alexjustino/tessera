import {
  CheckmarkCircle16Regular,
  Circle16Regular,
  Document16Regular,
  DocumentAdd16Regular,
} from '@fluentui/react-icons';
import type { CSSProperties } from 'react';

import { useBlocks, useItems } from '@/data/hooks';
import { plainText } from '@/domain/document';
import { isCompleted } from '@/domain/item';
import { formatDue, systemZone } from '@/domain/schedule';

/** What a link points at: a page, a task, or a name with no page yet. */
export type LinkTarget =
  | { kind: 'page'; id: string; title: string }
  | { kind: 'task'; id: string; title: string }
  | { kind: 'missing'; title: string };

/** How much of a page a preview shows. Enough to know it is the right one. */
const EXCERPT = 240;

function PagePreview({ id, title }: { id: string; title: string }) {
  const blocks = useBlocks('page', id);
  const text = plainText(blocks.data ?? []).trim();
  return (
    <>
      <p className="flex items-center gap-1.5 text-caption font-semibold text-success">
        <Document16Regular aria-hidden="true" />
        Page found
      </p>
      <p className="mt-1 truncate text-body font-semibold text-fg">{title}</p>
      <p className="mt-1 line-clamp-5 text-caption whitespace-pre-line text-fg-secondary">
        {blocks.isPending
          ? ' '
          : text === ''
            ? 'Nothing written here yet.'
            : text.length > EXCERPT
              ? `${text.slice(0, EXCERPT)}…`
              : text}
      </p>
    </>
  );
}

function TaskPreview({ id, title }: { id: string; title: string }) {
  const items = useItems(null, true);
  const task = (items.data ?? []).find((item) => item.id === id);
  const done = task !== undefined && isCompleted(task);
  return (
    <>
      <p className="flex items-center gap-1.5 text-caption font-semibold text-success">
        {done ? (
          <CheckmarkCircle16Regular aria-hidden="true" />
        ) : (
          <Circle16Regular aria-hidden="true" />
        )}
        Task found
      </p>
      <p className="mt-1 truncate text-body font-semibold text-fg">{task?.title ?? title}</p>
      <p className="mt-1 text-caption text-fg-secondary">
        {task === undefined
          ? 'This task is gone.'
          : done
            ? 'Finished.'
            : task.dueAt === null
              ? 'Open, with no date.'
              : `Open. Due ${formatDue(task.dueAt, new Date().toISOString(), systemZone())}.`}
      </p>
    </>
  );
}

/**
 * What a link will do, before it is pressed. The same words whether the link is
 * being chosen in the menu or is already in the text, so a person knows the name
 * they wrote points at something real, or that it does not yet.
 */
export function LinkPreviewBody({ target }: { target: LinkTarget }) {
  if (target.kind === 'page') return <PagePreview id={target.id} title={target.title} />;
  if (target.kind === 'task') return <TaskPreview id={target.id} title={target.title} />;
  return (
    <>
      <p className="flex items-center gap-1.5 text-caption font-semibold text-caution">
        <DocumentAdd16Regular aria-hidden="true" />
        No page with this name
      </p>
      <p className="mt-1 truncate text-body font-semibold text-fg">{target.title}</p>
      <p className="mt-1 text-caption text-fg-secondary">
        It will be made when you choose it, and the link will point at it.
      </p>
    </>
  );
}

/** The card shown beside a link in the text while the pointer or the focus is on it. */
export function LinkPreview({ target, style }: { target: LinkTarget; style: CSSProperties }) {
  return (
    <div
      role="tooltip"
      data-testid="link-preview"
      style={style}
      className="pointer-events-none absolute z-40 w-72 rounded-lg border border-stroke bg-flyout p-3 shadow-flyout backdrop-blur-xl"
    >
      <LinkPreviewBody target={target} />
      <p className="mt-2 border-t border-stroke-subtle pt-1.5 text-caption text-fg-tertiary">
        {target.kind === 'missing' ? 'Press to create it.' : 'Press to open.'}
      </p>
    </div>
  );
}
