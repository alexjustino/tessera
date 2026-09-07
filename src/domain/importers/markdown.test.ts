import { describe, expect, it } from 'vitest';

import { fromMarkdown, inline, plainText } from './markdown';

/** The types of the blocks a document became, in order. */
const kinds = (text: string, skipTitle = true) =>
  fromMarkdown(text, skipTitle).map((block) => block.type);

describe('reading Markdown as blocks', () => {
  it('reads headings, and drops the leading title Notion repeats', () => {
    expect(kinds('# The page\n\nSome words.\n')).toEqual(['paragraph']);
    expect(kinds('# The page\n\nSome words.\n', false)).toEqual(['heading', 'paragraph']);
    expect(kinds('## Later\n\n### Deeper\n')).toEqual(['heading', 'heading']);

    const [later] = fromMarkdown('## Later\n');
    expect(later!.content).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Later' }],
    });
  });

  it('reads a task list, with the ticked items ticked', () => {
    const [list] = fromMarkdown('- [x] Done thing\n- [ ] Not yet\n');
    expect(list!.type).toBe('taskList');
    const items = (list!.content as { content: { attrs: { checked: boolean } }[] }).content;
    expect(items.map((item) => item.attrs.checked)).toEqual([true, false]);
  });

  it('reads bullet and numbered lists, keeping where a numbered one starts', () => {
    expect(kinds('- one\n- two\n')).toEqual(['bulletList']);
    expect(kinds('1. one\n2. two\n')).toEqual(['orderedList']);
    const [numbered] = fromMarkdown('3. three\n4. four\n');
    expect(numbered!.content).toMatchObject({ attrs: { start: 3 } });
    // A list that starts at one carries no attribute: that is the default.
    expect(fromMarkdown('1. one\n')[0]!.content).not.toHaveProperty('attrs');
  });

  it('reads quotes, rules and fenced code, keeping the code exactly', () => {
    expect(kinds('> Said once\n> and again\n')).toEqual(['blockquote']);
    expect(kinds('---\n')).toEqual(['horizontalRule']);

    const [code] = fromMarkdown('```ts\nconst a = 1;\n\nconst b = 2;\n```\n');
    expect(code!.type).toBe('codeBlock');
    expect(code!.content).toEqual({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const a = 1;\n\nconst b = 2;' }],
    });
    // A fence with no language says nothing rather than saying ''.
    expect(fromMarkdown('```\nplain\n```\n')[0]!.content).not.toHaveProperty('attrs');
  });

  it('joins the lines of a paragraph and stops at what starts something else', () => {
    const blocks = fromMarkdown('One line\nand its rest.\n- a bullet\n');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'bulletList']);
    expect(plainText([blocks[0]!])).toBe('One line and its rest.');
  });

  it('never throws, and reads nothing as nothing', () => {
    expect(fromMarkdown('')).toEqual([]);
    expect(fromMarkdown('\n\n\n')).toEqual([]);
    // An unclosed fence keeps the rest of the file as code rather than losing it.
    const [unclosed] = fromMarkdown('```\nstill here\n');
    expect(plainText([unclosed!])).toBe('still here');
    const huge = fromMarkdown('x'.repeat(4 * 1024 * 1024 + 1));
    expect(plainText(huge)).toBe('This page was too large to import.');
  });
});

describe('the marks inside a line', () => {
  it('reads bold, italic, code and links', () => {
    expect(inline('a **bold** word')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' word' },
    ]);
    expect(inline('_soft_')).toEqual([{ type: 'text', text: 'soft', marks: [{ type: 'italic' }] }]);
    expect(inline('`code()`')).toEqual([
      { type: 'text', text: 'code()', marks: [{ type: 'code' }] },
    ]);
    expect(inline('see [the docs](https://example.com/a)')).toEqual([
      { type: 'text', text: 'see ' },
      {
        type: 'text',
        text: 'the docs',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/a' } }],
      },
    ]);
  });

  it('leaves unbalanced syntax as the text it is', () => {
    expect(inline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
    expect(inline('a ** b')).toEqual([{ type: 'text', text: 'a ** b' }]);
    expect(inline('snake_case_name')).toEqual([{ type: 'text', text: 'snake_case_name' }]);
    expect(inline('')).toEqual([]);
  });
});
