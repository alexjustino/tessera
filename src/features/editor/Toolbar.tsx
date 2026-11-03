import {
  ArrowRedo20Regular,
  ArrowUndo20Regular,
  Code20Regular,
  Flag20Regular,
  Highlight20Regular,
  Info20Regular,
  Link20Regular,
  Table20Regular,
  TaskListLtr20Regular,
  TextBold20Regular,
  TextBulletListLtr20Regular,
  TextClearFormatting20Regular,
  TextItalic20Regular,
  TextNumberListLtr20Regular,
  TextQuote20Regular,
  TextStrikethrough20Regular,
  TextUnderline20Regular,
} from '@fluentui/react-icons';
import { useEditorState, type Editor as TipTapEditor } from '@tiptap/react';
import { useState, type ReactNode } from 'react';

import { checkLink } from '@/domain/document';
import { MARKER_ATTR, MARKERS, type MarkerId } from '@/domain/markers';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { EmailButton } from './EmailButton';
import { FollowUp } from './FollowUp';
import { setMarker } from './NoteMarker';

const STYLES = [
  { id: 'paragraph', label: 'Text' },
  { id: 'h1', label: 'Heading 1' },
  { id: 'h2', label: 'Heading 2' },
  { id: 'h3', label: 'Heading 3' },
] as const;

type StyleId = (typeof STYLES)[number]['id'];

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-stroke-subtle" />;
}

/**
 * The formatting bar: what a person expects to see over a page of notes.
 *
 * The slash menu stays for those who like it, but nothing says it is there, and
 * a person looking for bold should not have to know a keyboard shortcut exists.
 * Every button keeps the selection: pressing one must not take the text away.
 */
export function Toolbar({
  editor,
  ownerKind,
  ownerId,
  subject,
}: {
  editor: TipTapEditor;
  /** What an email from this document is called. */
  subject: string;
  /** What this document belongs to, so a follow-up can be paired with it. */
  ownerKind: string;
  ownerId: string;
}) {
  const [following, setFollowing] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState('');
  const [complaint, setComplaint] = useState<string | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      style: (current.isActive('heading', { level: 1 })
        ? 'h1'
        : current.isActive('heading', { level: 2 })
          ? 'h2'
          : current.isActive('heading', { level: 3 })
            ? 'h3'
            : 'paragraph') as StyleId,
      marker: (current.getAttributes('paragraph')[MARKER_ATTR] ??
        current.getAttributes('heading')[MARKER_ATTR] ??
        '') as string,
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      highlight: current.isActive('highlight'),
      bullets: current.isActive('bulletList'),
      numbers: current.isActive('orderedList'),
      todo: current.isActive('taskList'),
      quote: current.isActive('blockquote'),
      code: current.isActive('codeBlock'),
      link: current.isActive('link'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();

  const setStyle = (style: StyleId) => {
    if (style === 'paragraph') chain().setParagraph().run();
    else
      chain()
        .setHeading({ level: Number(style.slice(1)) as 1 | 2 | 3 })
        .run();
  };

  const applyLink = () => {
    const checked = checkLink(address);
    if (checked.status !== 'ok') {
      setComplaint(checked.message);
      return;
    }
    chain().extendMarkRange('link').setLink({ href: checked.href }).run();
    setLinking(false);
    setAddress('');
    setComplaint(null);
  };

  const button = (
    label: string,
    icon: ReactNode,
    onPress: () => void,
    selected = false,
    disabled = false,
  ) => (
    <IconButton
      label={label}
      icon={icon}
      selected={selected}
      disabled={disabled}
      // Pressing a button must leave the selection where it is.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    />
  );

  return (
    <div className="sticky top-0 z-10 mb-3 rounded-md border border-stroke-subtle bg-card p-1">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-0.5"
        data-testid="editor-toolbar"
      >
        {button('Undo', <ArrowUndo20Regular />, () => chain().undo().run(), false, !state.canUndo)}
        {button('Redo', <ArrowRedo20Regular />, () => chain().redo().run(), false, !state.canRedo)}
        <Divider />
        <div className="w-36 shrink-0">
          <Select
            aria-label="Text style"
            value={state.style}
            onChange={(event) => setStyle(event.target.value as StyleId)}
          >
            {STYLES.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-32 shrink-0">
          <Select
            aria-label="Marker"
            title="Mark this line. Ctrl+1 to Ctrl+5."
            value={state.marker}
            onChange={(event) => {
              setMarker(editor, (event.target.value || null) as MarkerId | null);
              editor.commands.focus();
            }}
          >
            <option value="">No marker</option>
            {MARKERS.map((marker) => (
              <option key={marker.id} value={marker.id}>
                {marker.label}
              </option>
            ))}
          </Select>
        </div>
        <Divider />
        {button('Bold', <TextBold20Regular />, () => chain().toggleBold().run(), state.bold)}
        {button(
          'Italic',
          <TextItalic20Regular />,
          () => chain().toggleItalic().run(),
          state.italic,
        )}
        {button(
          'Underline',
          <TextUnderline20Regular />,
          () => chain().toggleUnderline().run(),
          state.underline,
        )}
        {button(
          'Strikethrough',
          <TextStrikethrough20Regular />,
          () => chain().toggleStrike().run(),
          state.strike,
        )}
        {button(
          'Highlight',
          <Highlight20Regular />,
          () => chain().toggleHighlight().run(),
          state.highlight,
        )}
        <Divider />
        {button(
          'Bulleted list',
          <TextBulletListLtr20Regular />,
          () => chain().toggleBulletList().run(),
          state.bullets,
        )}
        {button(
          'Numbered list',
          <TextNumberListLtr20Regular />,
          () => chain().toggleOrderedList().run(),
          state.numbers,
        )}
        {button(
          'To-do list',
          <TaskListLtr20Regular />,
          () => chain().toggleTaskList().run(),
          state.todo,
        )}
        <Divider />
        {button(
          'Quote',
          <TextQuote20Regular />,
          () => chain().toggleBlockquote().run(),
          state.quote,
        )}
        {button('Code block', <Code20Regular />, () => chain().toggleCodeBlock().run(), state.code)}
        {button('Callout', <Info20Regular />, () =>
          chain()
            .insertContent({ type: 'callout', content: [{ type: 'paragraph' }] })
            .run(),
        )}
        {button('Table', <Table20Regular />, () =>
          chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        )}
        <Divider />
        {button(
          'Link',
          <Link20Regular />,
          () => {
            setLinking(!linking);
            setAddress((editor.getAttributes('link').href as string | undefined) ?? '');
            setComplaint(null);
          },
          state.link,
        )}
        {button('Follow up on this line', <Flag20Regular />, () =>
          setFollowing(following === null ? editor.state.selection.$from.parent.textContent : null),
        )}
        <EmailButton editor={editor} ownerKind={ownerKind} ownerId={ownerId} subject={subject} />
        {button('Clear formatting', <TextClearFormatting20Regular />, () =>
          chain().unsetAllMarks().clearNodes().run(),
        )}
      </div>

      {following !== null && (
        <FollowUp
          title={following}
          ownerKind={ownerKind}
          ownerId={ownerId}
          onDone={(made) => {
            setFollowing(null);
            if (made) setMarker(editor, 'followup');
            editor.commands.focus();
          }}
        />
      )}

      {linking && (
        <form
          className="mt-1 flex flex-wrap items-center gap-2 border-t border-stroke-subtle pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <Input
            autoFocus
            aria-label="Link address"
            placeholder="https://"
            value={address}
            className="min-w-48 flex-1"
            onChange={(event) => {
              setAddress(event.target.value);
              setComplaint(null);
            }}
          />
          <Button type="submit">Apply</Button>
          {state.link && (
            <Button
              appearance="subtle"
              onClick={() => {
                chain().extendMarkRange('link').unsetLink().run();
                setLinking(false);
              }}
            >
              Remove link
            </Button>
          )}
          {complaint !== null && <p className="w-full text-caption text-danger">{complaint}</p>}
        </form>
      )}
    </div>
  );
}
