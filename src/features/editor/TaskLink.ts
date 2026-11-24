import { mergeAttributes, Node } from '@tiptap/core';

import { TASK_LINK } from '@/domain/page';

/**
 * A task, named inside a sentence.
 *
 * The same shape as a link to a page, and for the same reasons: one thing that
 * cannot be half-selected, an identity beside the words it shows. The words are
 * brought up to date as the document opens, so a renamed task reads as it is.
 */
export const TaskLink = Node.create({
  name: TASK_LINK,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      itemId: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('data-item-id') || null,
        renderHTML: (attributes) =>
          attributes.itemId === null ? {} : { 'data-item-id': attributes.itemId as string },
      },
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') ?? element.textContent ?? '',
        renderHTML: (attributes) => ({ 'data-title': attributes.title as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-task-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-task-link': '',
        role: 'link',
        tabindex: '0',
      }),
      (node.attrs.title as string) || 'A task',
    ];
  },

  renderText({ node }) {
    return (node.attrs.title as string) || '';
  },
});
