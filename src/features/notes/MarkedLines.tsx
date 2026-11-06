import { useMemo } from 'react';

import { useItems, useMarkedBlocks } from '@/data/hooks';
import { byMarker, isLineDone, markedLines, type MarkedLine } from '@/domain/markers';
import { Card } from '@/ui/Card';
import { EmptyState } from '@/ui/EmptyState';
import { Page, PageColumns } from '@/ui/Page';

/**
 * Every marked line in the workspace, under its marker: the questions still open,
 * the decisions taken, wherever they were written.
 */
export function MarkedLines({ onOpen }: { onOpen: (line: MarkedLine) => void }) {
  const blocks = useMarkedBlocks();
  const items = useItems(null, true);
  const groups = useMemo(() => byMarker(markedLines(blocks.data ?? [])), [blocks.data]);
  const finished = useMemo(
    () =>
      new Set(
        (items.data ?? []).filter((item) => item.completedAt !== null).map((item) => item.id),
      ),
    [items.data],
  );

  return (
    <Page>
      <header>
        <h1 className="text-title font-semibold text-fg">Marked lines</h1>
        <p className="mt-1 text-body text-fg-secondary">
          Every line you marked, in pages and in task notes. Press one to go to where it was
          written.
        </p>
      </header>

      {groups.length === 0 ? (
        <EmptyState
          title="No marked lines yet"
          description="In a page or a task's notes, pick a marker in the bar, or press Ctrl+1 to Ctrl+5."
        />
      ) : (
        <PageColumns>
          {groups.map((group) => (
            <div key={group.marker} data-testid={`marker-${group.marker}`}>
              <Card title={`${group.label} (${group.lines.length})`}>
                <ul className="flex flex-col gap-0.5">
                  {group.lines.map((line) => {
                    const done = isLineDone(line, finished);
                    return (
                      <li key={line.key} data-line-done={done ? 'true' : undefined}>
                        <button
                          type="button"
                          disabled={line.ownerKind === 'event'}
                          onClick={() => onOpen(line)}
                          className="flex w-full flex-col rounded-md px-2 py-1 text-left enabled:hover:bg-card-hover"
                        >
                          <span
                            className={`text-body ${done ? 'text-fg-tertiary line-through' : 'text-fg'}`}
                          >
                            {line.text}
                          </span>
                          <span className="text-caption text-fg-tertiary">
                            {done ? 'Done · ' : ''}
                            {line.ownerKind === 'item' ? 'Task: ' : ''}
                            {line.ownerTitle}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          ))}
        </PageColumns>
      )}
    </Page>
  );
}
