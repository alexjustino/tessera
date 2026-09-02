import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { EditorContent, useEditor, type Editor as TipTapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useApplyBlocks, useBlocks } from '@/data/hooks';
import {
  diff,
  isEmptyChange,
  plainText,
  toDocument,
  type Block,
  type DocJSON,
} from '@/domain/document';

import { BlockId, newId } from './BlockId';
import { Callout } from './Callout';
import { SlashMenu } from './SlashMenu';
import { useSlashMenu } from './useSlashMenu';
import './editor.css';

const lowlight = createLowlight(common);

/** How long the editor waits after the last keystroke before saving. */
const SAVE_DELAY_MS = 600;

/**
 * The document editor.
 *
 * # Saving
 *
 * Not on every keystroke, and not on a timer that ignores what is happening.
 * The editor waits for a pause, then writes only what changed — the diff is
 * computed in the domain layer and is usually one row.
 *
 * The pending save is flushed when the editor closes. That single detail is
 * what stops the last sentence somebody typed from disappearing because they
 * shut the panel before the debounce fired, which is the failure people never
 * forgive and never report accurately.
 */
export function Editor({ ownerKind, ownerId }: { ownerKind: string; ownerId: string }) {
  const blocks = useBlocks(ownerKind, ownerId);
  const apply = useApplyBlocks();

  /** What the host is known to hold. The diff is computed against this. */
  const stored = useRef<Block[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<DocJSON | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    (document: DocJSON) => {
      const changes = diff(stored.current, document.content, newId);
      if (isEmptyChange(changes)) return;

      // The local snapshot moves forward optimistically, so a save that lands
      // while the person keeps typing diffs against what was sent rather than
      // against what was on screen a second ago — which would resend the same
      // rows and, worse, recreate blocks that already exist.
      const next: Block[] = [
        ...stored.current
          .filter((block) => !changes.deletes.includes(block.id))
          .map((block) => {
            const update = changes.updates.find((candidate) => candidate.id === block.id);
            return update === undefined
              ? block
              : {
                  id: block.id,
                  type: update.type,
                  position: update.position,
                  content: update.content,
                };
          }),
        ...changes.creates.map((create) => ({
          id: create.id,
          type: create.type,
          position: create.position,
          content: create.content,
        })),
      ];
      stored.current = next;

      setSaving(true);
      apply.mutate(
        { ownerKind, ownerId, changes, plainText: plainText(next) },
        {
          onSuccess: (saved) => {
            stored.current = saved;
            setSaving(false);
          },
          // A failed save must not leave the snapshot claiming rows the host
          // does not have; the next read repairs it.
          onError: () => setSaving(false),
        },
      );
    },
    [apply, ownerKind, ownerId],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: false,
        // The document is stored as top-level rows, so a heading deeper than
        // three would have nowhere sensible to sit in an outline.
        heading: { levels: [1, 2, 3] },
      }),
      BlockId,
      Callout,
      Placeholder.configure({
        placeholder: 'Write something, or press / for a block',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ inline: false }),
      Link.configure({
        openOnClick: false,
        // Only http and https are stored. A `javascript:` link in a document is
        // a script waiting for a click.
        protocols: ['http', 'https'],
        autolink: true,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'tessera-prose',
        'data-selectable': 'true',
      },
    },
    onUpdate: ({ editor: instance }) => {
      pending.current = instance.getJSON() as DocJSON;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (pending.current !== null) save(pending.current);
        pending.current = null;
      }, SAVE_DELAY_MS);
    },
  });

  const slash = useSlashMenu(editor);

  // Load the document once it arrives, and only when it is genuinely different
  // from what is on screen. Setting the content of an editor somebody is typing
  // in moves their cursor to the top.
  useEffect(() => {
    if (editor === null || blocks.data === undefined) return;
    if (stored.current.length > 0) return;

    stored.current = blocks.data;
    editor.commands.setContent(toDocument(blocks.data) as never, { emitUpdate: false });
  }, [editor, blocks.data]);

  // Flush on the way out. Without this, the last sentence typed before closing
  // the panel is lost with no error and no trace.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (pending.current !== null) save(pending.current);
    },
    [save],
  );

  if (blocks.isPending) {
    return <div className="h-24 animate-pulse rounded-md bg-card-hover" aria-hidden="true" />;
  }

  return (
    <div className="relative">
      <EditorContent editor={editor} />
      {slash.open && editor !== null && <SlashMenu editor={editor} state={slash} />}

      <p aria-live="polite" className="mt-3 h-4 text-caption text-fg-tertiary">
        {saving ? 'Saving…' : ''}
      </p>
    </div>
  );
}

export type { TipTapEditor };
