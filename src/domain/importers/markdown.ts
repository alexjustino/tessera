/**
 * Markdown, as the editor's blocks.
 *
 * Notion exports a page as a Markdown file, so a page's text arrives as
 * Markdown and has to become the node JSON the editor already stores. This is
 * a reader for the Markdown people actually write — headings, lists, task
 * lists, quotes, code fences, rules, paragraphs, with bold, italic, code and
 * links inside them — and not a CommonMark implementation. What it does not
 * recognise stays as the text it was, because a paragraph of unread syntax is
 * still the person's words; a dropped paragraph is not.
 *
 * It never throws. Every line lands somewhere.
 */

/** One top-level node, as a block row stores it. */
export interface MarkdownBlock {
  type: string;
  content: unknown;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const TASK_ITEM = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET_ITEM = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^\s*(\d+)[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```(\w*)\s*$/;

const WORD = /\w/;

/** The largest page an importer will read as blocks. */
export const MAX_MARKDOWN_CHARS = 4 * 1024 * 1024;

/**
 * A Markdown document as blocks, in order.
 *
 * Notion writes the page title as the first heading of the file, and the
 * caller already knows the title from the row, so `skipTitle` drops a leading
 * level-one heading rather than repeating it inside the document.
 */
export function fromMarkdown(text: string, skipTitle = true): MarkdownBlock[] {
  if (text.length > MAX_MARKDOWN_CHARS) {
    return [paragraph('This page was too large to import.')];
  }

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  let droppedTitle = !skipTitle;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index]!)) {
        body.push(lines[index]!);
        index += 1;
      }
      index += 1; // the closing fence, or the end of the file
      blocks.push({
        type: 'codeBlock',
        content: {
          type: 'codeBlock',
          ...(language === '' ? {} : { attrs: { language } }),
          content: body.length === 0 ? [] : [{ type: 'text', text: body.join('\n') }],
        },
      });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'horizontalRule', content: { type: 'horizontalRule' } });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const words = heading[2]!.trim();
      if (!droppedTitle && level === 1) {
        droppedTitle = true;
        index += 1;
        continue;
      }
      droppedTitle = true;
      blocks.push({
        type: 'heading',
        content: {
          type: 'heading',
          attrs: { level: Math.min(level, 6) },
          content: inline(words),
        },
      });
      index += 1;
      continue;
    }
    droppedTitle = true;

    if (TASK_ITEM.test(line)) {
      const items: unknown[] = [];
      while (index < lines.length) {
        const match = TASK_ITEM.exec(lines[index]!);
        if (!match) break;
        items.push({
          type: 'taskItem',
          attrs: { checked: match[1]!.toLowerCase() === 'x' },
          content: [{ type: 'paragraph', content: inline(match[2]!) }],
        });
        index += 1;
      }
      blocks.push({ type: 'taskList', content: { type: 'taskList', content: items } });
      continue;
    }

    if (BULLET_ITEM.test(line)) {
      const items: unknown[] = [];
      while (
        index < lines.length &&
        BULLET_ITEM.test(lines[index]!) &&
        !TASK_ITEM.test(lines[index]!)
      ) {
        const match = BULLET_ITEM.exec(lines[index]!)!;
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: inline(match[1]!) }],
        });
        index += 1;
      }
      blocks.push({ type: 'bulletList', content: { type: 'bulletList', content: items } });
      continue;
    }

    if (ORDERED_ITEM.test(line)) {
      const first = Number(ORDERED_ITEM.exec(line)![1]);
      const items: unknown[] = [];
      while (index < lines.length && ORDERED_ITEM.test(lines[index]!)) {
        const match = ORDERED_ITEM.exec(lines[index]!)!;
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: inline(match[2]!) }],
        });
        index += 1;
      }
      blocks.push({
        type: 'orderedList',
        content: {
          type: 'orderedList',
          ...(first === 1 ? {} : { attrs: { start: first } }),
          content: items,
        },
      });
      continue;
    }

    if (QUOTE.test(line)) {
      const said: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index]!)) {
        said.push(QUOTE.exec(lines[index]!)![1]!);
        index += 1;
      }
      blocks.push({
        type: 'blockquote',
        content: {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: inline(said.join(' ').trim()) }],
        },
      });
      continue;
    }

    // A paragraph runs until a blank line or a line that starts something else.
    const said: string[] = [];
    while (index < lines.length) {
      const next = lines[index]!;
      if (next.trim() === '' || startsSomething(next)) break;
      said.push(next.trim());
      index += 1;
    }
    blocks.push(paragraph(said.join(' ')));
  }

  return blocks;
}

function startsSomething(line: string): boolean {
  return (
    HEADING.test(line) ||
    TASK_ITEM.test(line) ||
    BULLET_ITEM.test(line) ||
    ORDERED_ITEM.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line) ||
    FENCE.test(line)
  );
}

function paragraph(text: string): MarkdownBlock {
  return { type: 'paragraph', content: { type: 'paragraph', content: inline(text) } };
}

/**
 * The marks inside a line: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`.
 *
 * Left to right, one pass, first match wins. Unbalanced syntax is text —
 * `2 * 3 * 4` is arithmetic, not emphasis, and comes out as it went in.
 */
export function inline(text: string): unknown[] {
  const nodes: unknown[] = [];
  let plain = '';
  let index = 0;

  const flush = () => {
    if (plain !== '') {
      nodes.push({ type: 'text', text: plain });
      plain = '';
    }
  };
  const marked = (value: string, marks: { type: string; attrs?: unknown }[]) => {
    flush();
    nodes.push({ type: 'text', text: value, marks });
  };

  while (index < text.length) {
    const rest = text.slice(index);

    const link = /^\[([^\]]*)\]\(([^)\s]+)[^)]*\)/.exec(rest);
    if (link && link[1] !== '') {
      marked(link[1]!, [{ type: 'link', attrs: { href: link[2]! } }]);
      index += link[0].length;
      continue;
    }

    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      marked(code[1]!, [{ type: 'code' }]);
      index += code[0].length;
      continue;
    }

    const bold = /^(\*\*|__)(?=\S)(.+?)(?<=\S)\1/.exec(rest);
    if (bold && emphasisHolds(text, index, bold[0].length, bold[1]!)) {
      marked(bold[2]!, [{ type: 'bold' }]);
      index += bold[0].length;
      continue;
    }

    const italic = /^(\*|_)(?=\S)([^*_]+?)(?<=\S)\1/.exec(rest);
    if (italic && emphasisHolds(text, index, italic[0].length, italic[1]!)) {
      marked(italic[2]!, [{ type: 'italic' }]);
      index += italic[0].length;
      continue;
    }

    plain += text[index];
    index += 1;
  }

  flush();
  return nodes.length === 0 ? [] : nodes;
}

/**
 * Whether emphasis at `index` is emphasis at all.
 *
 * An underscore inside a word is not: `snake_case_name` is an identifier, and
 * Markdown agrees — intraword emphasis needs asterisks. So a run delimited by
 * `_` must have a non-word character on each side of it, or none at all.
 */
function emphasisHolds(text: string, index: number, length: number, delimiter: string): boolean {
  if (!delimiter.startsWith('_')) return true;
  const before = index === 0 ? '' : text[index - 1]!;
  const after = text[index + length] ?? '';
  return !WORD.test(before) && !WORD.test(after);
}

/** Every word in a document, for the search index and for a preview. */
export function plainText(blocks: readonly MarkdownBlock[]): string {
  const words: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.text === 'string') words.push(record.text);
    if (record.content !== undefined) walk(record.content);
  };
  blocks.forEach((block) => walk(block.content));
  return words.join(' ').replace(/\s+/g, ' ').trim();
}
