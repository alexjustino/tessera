import { Mail20Regular } from '@fluentui/react-icons';
import { DOMSerializer } from '@tiptap/pm/model';
import type { Editor as TipTapEditor } from '@tiptap/react';
import { useState } from 'react';

import { describeError } from '@/data/errors';
import { useItemPages, useItems } from '@/data/hooks';
import { draftEmail } from '@/data/system';
import { emailHtml, emailText, type FollowUpLine } from '@/domain/emailDraft';
import { isCompleted } from '@/domain/item';
import { announce } from '@/ui/announce';
import { IconButton } from '@/ui/IconButton';

/** What is selected, as HTML and lines of text. Nothing selected means the whole document. */
function contentOf(editor: TipTapEditor): { html: string; lines: string[] } {
  const { empty, from, to } = editor.state.selection;
  if (empty) {
    return { html: editor.getHTML(), lines: editor.getText({ blockSeparator: '\n' }).split('\n') };
  }
  const holder = document.createElement('div');
  holder.appendChild(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(
      editor.state.doc.slice(from, to).content,
    ),
  );
  return {
    html: holder.innerHTML,
    lines: editor.state.doc.textBetween(from, to, '\n').split('\n'),
  };
}

/** Turn the page, or what is selected, into a draft in the person's own mail program. */
export function EmailButton({
  editor,
  ownerKind,
  ownerId,
  subject,
}: {
  editor: TipTapEditor;
  ownerKind: string;
  ownerId: string;
  subject: string;
}) {
  const items = useItems(null, true);
  const pairs = useItemPages();
  const [failure, setFailure] = useState<string | null>(null);

  const followUps = (): FollowUpLine[] => {
    if (ownerKind !== 'page') return [];
    const ids = new Set(
      (pairs.data ?? []).filter((pair) => pair.pageId === ownerId).map((pair) => pair.itemId),
    );
    return (items.data ?? [])
      .filter((item) => ids.has(item.id) && !isCompleted(item))
      .map((item) => ({
        title: item.title,
        due: item.dueAt === null ? null : new Date(item.dueAt).toLocaleDateString(),
      }));
  };

  const draft = () => {
    const { html, lines } = contentOf(editor);
    const listed = followUps();
    setFailure(null);
    draftEmail(subject, emailHtml(html, listed), emailText(lines, listed))
      .then(() => announce('Email draft opened in your mail program'))
      .catch((error: unknown) => setFailure(describeError(error)));
  };

  return (
    <>
      <IconButton
        label="Draft an email from this"
        icon={<Mail20Regular />}
        onMouseDown={(event) => event.preventDefault()}
        onClick={draft}
      />
      {failure !== null && (
        <p role="alert" className="w-full text-caption text-danger">
          The draft did not open: {failure}
        </p>
      )}
    </>
  );
}
