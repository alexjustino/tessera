import { mergeAttributes, Node, wrappingInputRule, type SingleCommands } from '@tiptap/core';

/**
 * A callout: a block that says "read this one twice".
 *
 * Written here rather than installed because the two ready-made options are
 * both wrong for this product — one is a paid extension, and the other brings
 * its own colours, which is exactly what the design system exists to prevent.
 * A callout's tone names a token; it can never introduce a shade the product
 * does not own.
 */
export type CalloutTone = 'info' | 'success' | 'caution' | 'danger';

const TONES: CalloutTone[] = ['info', 'success', 'caution', 'danger'];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: 'info' as CalloutTone,
        parseHTML: (element) => {
          const tone = element.getAttribute('data-tone');
          return TONES.includes(tone as CalloutTone) ? tone : 'info';
        },
        renderHTML: (attributes) => ({ 'data-tone': attributes.tone }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0];
  },

  addInputRules() {
    // Typing "> > " opens one, next to blockquote's "> ".
    return [wrappingInputRule({ find: /^>>\s$/, type: this.type })];
  },

  addCommands() {
    return {
      setCallout:
        (tone: CalloutTone = 'info') =>
        ({ commands }: { commands: SingleCommands }) =>
          commands.wrapIn(this.name, { tone }),
      unsetCallout:
        () =>
        ({ commands }: { commands: SingleCommands }) =>
          commands.lift(this.name),
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (tone?: CalloutTone) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}
