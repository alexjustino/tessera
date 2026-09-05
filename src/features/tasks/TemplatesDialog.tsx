import { Delete20Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';

import { describeError } from '@/data/errors';
import { useApplyTemplate, useCreateTemplate, useDeleteTemplate, useTemplates } from '@/data/hooks';
import { todayIn } from '@/domain/calendar';
import type { Edge } from '@/domain/graph';
import { sortItems, type Item } from '@/domain/item';
import { sequence } from '@/domain/ordering';
import { systemZone } from '@/domain/schedule';
import { capture, checkName, describe, instantiate, type Template } from '@/domain/template';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { announce } from '@/ui/announce';

/**
 * Templates: keep the shape of the tasks on screen, and make tasks from a
 * shape kept before.
 *
 * Saving takes what the view is showing — the query's rows, in order — so
 * "these five tasks" is decided by the same filter the person is looking at,
 * not by a second picker. Applying asks for one thing, the day the template
 * starts, and says what it will make before it makes it.
 */
export function TemplatesDialog({
  open,
  onClose,
  collectionId,
  shown,
  all,
  edges,
}: {
  open: boolean;
  onClose: () => void;
  collectionId: string;
  /** The rows the view is showing: what "save as template" captures. */
  shown: readonly Item[];
  /** Every task in the collection, for the positions new ones take. */
  all: readonly Item[];
  edges: readonly Edge[];
}) {
  const zone = useMemo(() => systemZone(), []);
  const templates = useTemplates();
  const create = useCreateTemplate();
  const remove = useDeleteTemplate();
  const apply = useApplyTemplate();

  const [name, setName] = useState('');
  const [startDay, setStartDay] = useState(() => todayIn(new Date().toISOString(), zone));

  const body = useMemo(() => capture(shown, edges, zone), [shown, edges, zone]);

  const save = () => {
    const cleaned = checkName(name);
    if (cleaned === null) return;
    create.mutate(
      { name: cleaned, body },
      {
        onSuccess: () => {
          setName('');
          announce(`Saved ${cleaned} as a template`);
        },
      },
    );
  };

  const applyOne = (template: Template) => {
    const planned = instantiate(template.body, startDay, zone);
    const last = sortItems(all).at(-1)?.position ?? null;
    const positions = sequence(last, null, planned.tasks.length);
    apply.mutate(
      {
        collectionId,
        tasks: planned.tasks.map((task, index) => ({ ...task, position: positions[index]! })),
        edges: planned.edges,
      },
      {
        onSuccess: (created) => {
          announce(
            `Made ${created.length} ${created.length === 1 ? 'task' : 'tasks'} from ${template.name}`,
          );
          onClose();
        },
      },
    );
  };

  const failure = create.error ?? remove.error ?? apply.error ?? templates.error;

  return (
    <Modal open={open} label="Templates" onClose={onClose} width="lg">
      <div className="flex flex-col gap-5">
        <header>
          <h2 className="text-subtitle font-semibold text-fg">Templates</h2>
          <p className="mt-1 text-body text-fg-secondary">
            Keep the shape of a set of tasks — their estimates, dependencies and how the dates fall
            — and make it again on any day.
          </p>
        </header>

        {failure !== null && failure !== undefined && (
          <InfoBar severity="danger" title="That did not work">
            {describeError(failure)}
          </InfoBar>
        )}

        <section aria-label="Save what is shown">
          <h3 className="mb-1 text-caption font-semibold text-fg-tertiary uppercase">
            Save what is shown
          </h3>
          <p className="mb-2 text-caption text-fg-tertiary" data-testid="template-preview">
            {shown.length === 0
              ? 'Nothing is shown, so there is nothing to save.'
              : `${describe(body)} — as the view shows them now.`}
          </p>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <span className="flex-1">
              <Input
                aria-label="Template name"
                placeholder="Launch, sprint, onboarding…"
                value={name}
                disabled={shown.length === 0 || create.isPending}
                onChange={(event) => setName(event.target.value)}
              />
            </span>
            <Button
              type="submit"
              appearance="accent"
              disabled={shown.length === 0 || checkName(name) === null || create.isPending}
            >
              Save as template
            </Button>
          </form>
        </section>

        <section aria-label="Templates kept">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-caption font-semibold text-fg-tertiary uppercase">
              Make tasks from
            </h3>
            <label className="flex items-center gap-2 text-caption text-fg-tertiary">
              Starting on
              <Input
                type="date"
                aria-label="Starting on"
                value={startDay}
                onChange={(event) => setStartDay(event.target.value)}
              />
            </label>
          </div>

          {(templates.data ?? []).length === 0 ? (
            <EmptyState
              title="No templates yet"
              description="Save what the view is showing, and it will be here to apply on any day."
            />
          ) : (
            <ul className="flex flex-col gap-1">
              {(templates.data ?? []).map((template) => (
                <li
                  key={template.id}
                  className="flex items-center gap-3 rounded-md border border-stroke-subtle bg-card px-3 py-2"
                  data-testid="template"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold text-fg">{template.name}</p>
                    <p className="text-caption text-fg-tertiary">{describe(template.body)}</p>
                  </div>
                  <Button
                    appearance="standard"
                    disabled={apply.isPending || startDay === ''}
                    onClick={() => applyOne(template)}
                    aria-label={`Make tasks from ${template.name}`}
                  >
                    Apply
                  </Button>
                  <IconButton
                    label={`Delete the template ${template.name}`}
                    icon={<Delete20Regular />}
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(template.id, {
                        onSuccess: () => announce(`Deleted the template ${template.name}`),
                      })
                    }
                    className="hover:text-danger"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
