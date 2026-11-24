import { formatDuration } from '@/domain/criticalPath';
import { printedDue } from '@/domain/printing';
import type { Group } from '@/domain/query';

/**
 * The tasks a view shows, as a table for paper (ADR-066): a box to tick by hand,
 * the task, its list, when it is due and how long it should take, in the view's
 * own groups and order. The screen's rows are made for a pointer; this is made
 * for a pen.
 */
export function TaskPrintTable({
  groups,
  listNameOf,
  now = new Date(),
}: {
  groups: readonly Group[];
  listNameOf: (collectionId: string) => string | undefined;
  now?: Date;
}) {
  const grouped = groups.length > 1 || (groups[0] !== undefined && groups[0].label !== '');
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  if (total === 0) {
    return (
      <p className="hidden print:block" data-print-table>
        Nothing to show.
      </p>
    );
  }
  return (
    <table className="print-table hidden print:table" data-print-table>
      <colgroup>
        <col className="print-col-box" />
        <col />
        <col className="print-col-list" />
        <col className="print-col-due" />
        <col className="print-col-estimate" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" aria-label="Done" />
          <th scope="col">Task</th>
          <th scope="col">List</th>
          <th scope="col">Due</th>
          <th scope="col">Estimate</th>
        </tr>
      </thead>
      {groups
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <tbody key={group.key ?? 'none'}>
            {grouped && (
              <tr className="print-group" data-print-row>
                <th scope="colgroup" colSpan={5}>
                  {group.label === '' ? 'No value' : group.label}
                  <span className="print-group-count">{group.rows.length}</span>
                </th>
              </tr>
            )}
            {group.rows.map(({ item }) => {
              const done = item.completedAt !== null;
              const late = !done && item.dueAt !== null && new Date(item.dueAt) < now;
              return (
                <tr
                  key={item.id}
                  data-print-row
                  className={[done ? 'print-done' : '', late ? 'print-late' : ''].join(' ')}
                >
                  <td>
                    <span className="print-box" aria-label={done ? 'Done' : 'Open'}>
                      {done ? '✓' : ''}
                    </span>
                  </td>
                  <td className="print-task">{item.title}</td>
                  <td>{listNameOf(item.collectionId) ?? ''}</td>
                  <td>
                    {printedDue(item.dueAt)}
                    {late && <span className="print-late-word"> · late</span>}
                  </td>
                  <td>
                    {item.estimateMinutes === null ? '' : formatDuration(item.estimateMinutes)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
    </table>
  );
}
