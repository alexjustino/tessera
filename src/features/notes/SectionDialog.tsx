import { useState } from 'react';

import { describeError } from '@/data/errors';
import { useCreateSection, useDeleteSection, useSections, useUpdateSection } from '@/data/hooks';
import { nextColor, type ColorId } from '@/domain/colors';
import { checkSectionName, positionForNewSection, type Section } from '@/domain/sections';
import { Button } from '@/ui/Button';
import { ColorPicker } from '@/ui/ColorPicker';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { announce } from '@/ui/announce';

/**
 * Make a section, or rename, recolour or delete one. Deleting says where its pages
 * go before it is pressed, because they go somewhere: back to Quick notes.
 */
export function SectionDialog({
  editing,
  pagesInIt = 0,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** The section to change; null makes a new one. */
  editing: Section | null;
  pagesInIt?: number;
  onClose: () => void;
  onSaved: (section: Section) => void;
  onDeleted?: () => void;
}) {
  const sections = useSections();
  const create = useCreateSection();
  const update = useUpdateSection();
  const remove = useDeleteSection();
  const all = sections.data ?? [];
  const [name, setName] = useState(editing?.name ?? '');
  const [color, setColor] = useState<ColorId | null>(
    editing === null ? nextColor(all.map((section) => section.color)) : editing.color,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const pending = create.isPending || update.isPending || remove.isPending;

  const save = () => {
    const result = checkSectionName(name, all, editing?.id ?? null);
    if (result.status === 'invalid') {
      setProblem(result.reason);
      return;
    }
    const done = {
      onSuccess: (section: Section) => {
        announce(editing === null ? `Made the section ${section.name}` : `Saved ${section.name}`);
        onSaved(section);
      },
      onError: (error: unknown) => setProblem(describeError(error)),
    };
    if (editing === null) {
      create.mutate({ name: result.name, color, position: positionForNewSection(all) }, done);
    } else {
      update.mutate({ id: editing.id, name: result.name, color }, done);
    }
  };

  return (
    <Modal open label={editing === null ? 'New section' : `Edit ${editing.name}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4 p-5"
        data-testid="section-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h2 className="text-body-lg font-semibold text-fg">
          {editing === null ? 'New section' : `Edit ${editing.name}`}
        </h2>
        <label className="flex flex-col gap-1 text-caption text-fg-secondary">
          Name
          <Input
            autoFocus
            aria-label="Section name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-secondary">Colour</span>
          <ColorPicker value={color} onChange={setColor} label="Section colour" />
        </div>
        {problem !== null && (
          <InfoBar severity="caution" title="Not yet">
            {problem}
          </InfoBar>
        )}
        {confirmingDelete && editing !== null && (
          <InfoBar severity="caution" title={`Delete ${editing.name}?`}>
            {pagesInIt === 0
              ? 'It holds no pages.'
              : `Its ${pagesInIt === 1 ? 'page goes' : `${pagesInIt} pages go`} back to Quick notes. No page is deleted.`}
          </InfoBar>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {editing !== null &&
              (confirmingDelete ? (
                <Button
                  appearance="subtle"
                  disabled={pending}
                  onClick={() =>
                    remove.mutate(editing.id, {
                      onSuccess: () => {
                        announce(`Deleted the section ${editing.name}`);
                        onDeleted?.();
                      },
                      onError: (error) => setProblem(describeError(error)),
                    })
                  }
                >
                  Delete the section
                </Button>
              ) : (
                <Button appearance="subtle" onClick={() => setConfirmingDelete(true)}>
                  Delete…
                </Button>
              ))}
          </div>
          <div className="flex gap-1">
            <Button appearance="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" appearance="accent" disabled={pending}>
              {editing === null ? 'Make the section' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
