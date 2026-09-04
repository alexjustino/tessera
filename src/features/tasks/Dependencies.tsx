import { Add16Regular, Dismiss12Regular, Warning16Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useDependencies, useLinkDependency, useUnlinkDependency } from '@/data/hooks';
import { blockedBy, blockersOf, cycleFrom, describeCycle } from '@/domain/graph';
import type { Item } from '@/domain/item';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';
import { Select } from '@/ui/Select';
import { announce } from '@/ui/announce';

/**
 * What must come first, on one task.
 *
 * Two lists, because the two directions mean different things to a person:
 * *waiting for* is what stops this task starting, and is editable here;
 * *waited on by* is the consequence of this task, and is shown so that
 * finishing it visibly releases something.
 *
 * The picker only offers what would not close a loop. Offering everything and
 * refusing afterwards teaches a person that the product says no; offering only
 * what works teaches them what the graph allows — and the one case the picker
 * cannot express, a link made from the other end, the host still refuses.
 */
export function Dependencies({ task, items }: { task: Item; items: readonly Item[] }) {
  const dependencies = useDependencies();
  const link = useLinkDependency();
  const unlink = useUnlinkDependency();
  const [chosen, setChosen] = useState('');

  const edges = useMemo(() => dependencies.data ?? [], [dependencies.data]);
  const titleOf = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    return (id: string) => byId.get(id)?.title ?? 'a task that is gone';
  }, [items]);
  const completed = useMemo(
    () => new Set(items.filter((item) => item.completedAt !== null).map((item) => item.id)),
    [items],
  );

  const waitingFor = blockersOf(edges, task.id);
  const waitedOnBy = blockedBy(edges, task.id);

  /** Everything that could be added without closing a loop, in list order. */
  const offerable = useMemo(() => {
    const already = new Set(waitingFor);
    return items.filter(
      (candidate) =>
        candidate.id !== task.id &&
        !already.has(candidate.id) &&
        cycleFrom(edges, candidate.id, task.id) === null,
    );
  }, [items, edges, task.id, waitingFor]);

  /**
   * What the picker is not offering, and why — the honest half of a filtered
   * list. Without this the missing tasks look like a bug.
   */
  const wouldLoop = useMemo(
    () =>
      items.filter(
        (candidate) => candidate.id !== task.id && cycleFrom(edges, candidate.id, task.id) !== null,
      ),
    [items, edges, task.id],
  );

  const add = () => {
    if (chosen === '') return;
    const loop = cycleFrom(edges, chosen, task.id);
    if (loop !== null) {
      // The picker should not have offered it; the graph changed underneath.
      announce(`That would make a loop: ${describeCycle(loop, titleOf)}`, 'assertive');
      return;
    }
    link.mutate(
      { blockerId: chosen, blockedId: task.id },
      {
        onSuccess: () => {
          announce(`${task.title} now waits for ${titleOf(chosen)}`);
          setChosen('');
        },
      },
    );
  };

  const failure = dependencies.error ?? link.error ?? unlink.error;

  return (
    <section className="mt-6 border-t border-stroke-subtle pt-4">
      <h3 className="mb-2 text-caption font-semibold text-fg-tertiary uppercase">Waiting for</h3>

      {failure && (
        <InfoBar severity="danger" title="That link was not saved">
          {describeError(failure)}
        </InfoBar>
      )}

      {waitingFor.length === 0 ? (
        <p className="text-body text-fg-tertiary">
          Nothing. This task can start whenever you like.
        </p>
      ) : (
        <ul aria-label="Waiting for" className="mb-2 flex flex-col gap-1">
          {waitingFor.map((id) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded-md border border-stroke-subtle bg-card px-2 py-1"
            >
              {!completed.has(id) && (
                <Warning16Regular aria-hidden="true" className="shrink-0 text-caution" />
              )}
              <span
                className={`min-w-0 flex-1 truncate text-body ${
                  completed.has(id) ? 'text-fg-tertiary line-through' : 'text-fg'
                }`}
              >
                {titleOf(id)}
              </span>
              <button
                type="button"
                aria-label={`Stop waiting for ${titleOf(id)}`}
                onClick={() =>
                  unlink.mutate(
                    { blockerId: id, blockedId: task.id },
                    { onSuccess: () => announce(`No longer waiting for ${titleOf(id)}`) },
                  )
                }
                className="-my-1 grid h-8 w-6 shrink-0 place-items-center rounded-sm text-fg-tertiary hover:bg-card-hover hover:text-fg"
              >
                <Dismiss12Regular aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Select
          aria-label="Wait for another task"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          disabled={offerable.length === 0 || link.isPending}
        >
          <option value="">
            {offerable.length === 0 ? 'Nothing else can come first' : 'Wait for…'}
          </option>
          {offerable.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </Select>
        <Button icon={<Add16Regular />} onClick={add} disabled={chosen === '' || link.isPending}>
          Add
        </Button>
      </div>

      {wouldLoop.length > 0 && (
        <p className="mt-1.5 text-caption text-fg-tertiary">
          {wouldLoop.length === 1
            ? `${titleOf(wouldLoop[0]!.id)} is not offered: it already waits on this one.`
            : `${wouldLoop.length} tasks are not offered: they already wait on this one, directly or through others.`}
        </p>
      )}

      {waitedOnBy.length > 0 && (
        <>
          <h3 className="mt-4 mb-2 text-caption font-semibold text-fg-tertiary uppercase">
            Waited on by
          </h3>
          <ul aria-label="Waited on by" className="flex flex-col gap-1">
            {waitedOnBy.map((id) => (
              <li key={id} className="truncate px-2 py-1 text-body text-fg-secondary">
                {titleOf(id)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
