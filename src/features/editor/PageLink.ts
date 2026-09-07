import { mergeAttributes, Node } from '@tiptap/core';

import { PAGE_LINK } from '@/domain/page';

/**
 * A link to another page, written inside a sentence.
 *
 * An inline atom rather than a mark on some text: the link is one thing, and
 * selecting half of "Weekly Review" and unbolding it must not be able to leave
 * half a link behind. The words are an attribute, not content, so the node
 * cannot be edited into disagreeing with what it points at.
 *
 * Two attributes, and the difference between them is the whole design
 * (ADR-029): `pageId` is what the link **is**, `title` is what it **says**.
 * The id survives a rename; the title is refreshed from the id when the
 * document is opened. A link with no id is one written for a page that does
 * not exist — it still says the name, and it finds its page the day one is
 * made with that name.
 */
export const PageLink = Node.create({
  name: PAGE_LINK,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      pageId: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('data-page-id') || null,
        renderHTML: (attributes) =>
          attributes.pageId === null ? {} : { 'data-page-id': attributes.pageId as string },
      },
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') ?? element.textContent ?? '',
        renderHTML: (attributes) => ({ 'data-title': attributes.title as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-page-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs.title as string) || 'Untitled';
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-page-link': '',
        // A link to a page that does not exist is drawn differently, because a
        // wiki where a broken link looks like a good one is a wiki that lies.
        'data-missing': node.attrs.pageId === null ? '' : undefined,
        role: 'link',
        tabindex: '0',
      }),
      title,
    ];
  },

  /** What the document reads as, in plain text: the name it shows. */
  renderText({ node }) {
    return (node.attrs.title as string) || '';
  },
});
