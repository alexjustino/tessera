/**
 * Notion, from the Markdown & CSV export of one database.
 *
 * The export is a zip; unzipped it is a `.csv` beside a folder of the same
 * name holding one `.md` per row. The CSV carries the columns as a person
 * named them and their values as text — Notion writes no types into it — and
 * each Markdown file carries the page under a row.
 *
 * So the types are **inferred from the values**, which is what this module is
 * for, and the inference is deliberately timid: a column becomes a typed
 * property only when every value in it agrees, and text is the answer whenever
 * they do not. A wrong guess is worse than no guess, because the text is
 * always readable and a number that ate a serial code is not.
 *
 * The first column is the title, as Notion always writes it. Pages become the
 * task's document through `fromMarkdown`.
 */

import type { ImportPlan, ImportedProperty, ImportedTask, SelectOptionPlan } from '../importing';
import type { PropertyType } from '../property';

import { parseCsv } from './csv';
import { fromMarkdown, plainText } from './markdown';
import { slug } from './trello';

/** One page file beside the CSV: the file's name and its Markdown. */
export interface NotionPage {
  /** The file name, without `.md`. Notion appends a hash to the title. */
  name: string;
  text: string;
}

/** How many distinct values a column may have and still be a set of choices. */
const MAX_OPTIONS = 24;
/** …and how many rows it takes before repetition means anything. */
const MIN_ROWS_FOR_CHOICES = 4;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YES = /^(yes|true|✓|checked)$/i;
const NO = /^(no|false|unchecked)$/i;
const URL = /^https?:\/\/\S+$/i;

export function looksLikeNotion(text: string): boolean {
  const { header, rows } = parseCsv(text.slice(0, 8192));
  // Notion writes a title column first and at least one more; nothing else in
  // this product's importers has a plain header of arbitrary names.
  return header.length >= 2 && header[0]!.trim() !== '' && rows.length > 0;
}

/**
 * The plan for one Notion database.
 *
 * `pages` are the Markdown files from the folder beside the CSV; a row is
 * matched to the file whose name starts with the row's title, which is how
 * Notion names them (`Title abc123.md`).
 */
export function fromNotion(
  text: string,
  databaseName: string,
  pages: readonly NotionPage[] = [],
): ImportPlan | null {
  const table = parseCsv(text);
  if (table.header.length < 2 || table.rows.length === 0) return null;

  const collection = databaseName.trim() === '' ? 'Notion' : databaseName.trim();
  const warnings: string[] = [...table.problems];

  const [titleColumn, ...valueColumns] = table.header;
  const inferred = valueColumns
    .filter((name) => name.trim() !== '')
    .map((name) => ({ name, ...infer(table.rows.map((row) => row[name] ?? '')) }));

  const properties: ImportedProperty[] = [];
  for (const column of inferred) {
    if (column.type === 'skip') continue;
    properties.push({
      collection,
      name: column.name,
      type: column.type,
      ...(column.options === undefined ? {} : { options: column.options }),
    });
  }

  const byPrefix = new Map(pages.map((page) => [page.name, page]));
  let withPages = 0;
  let missingPages = 0;

  const tasks: ImportedTask[] = table.rows.map((row, index) => {
    const title = (row[titleColumn!] ?? '').trim();
    const values: Record<string, unknown> = {};
    for (const column of inferred) {
      if (column.type === 'skip') continue;
      const value = read(column, row[column.name] ?? '');
      if (value !== null) values[column.name] = value;
    }

    const page = findPage(byPrefix, title);
    const blocks = page === undefined ? [] : fromMarkdown(page.text);
    if (page !== undefined) withPages += 1;
    else if (pages.length > 0) missingPages += 1;

    return {
      key: `notion:${index + 2}`,
      collection,
      title: title === '' ? 'Untitled' : title,
      // The first paragraph doubles as the task's note, so the row says
      // something in a list that shows no document.
      notes: firstParagraph(blocks),
      startAt: null,
      dueAt: null,
      completedAt: null,
      estimateMinutes: null,
      isMilestone: false,
      values,
      blocks,
    };
  });

  const asText = inferred.filter((column) => column.type === 'text' && column.wanted !== undefined);
  if (asText.length > 0) {
    warnings.push(
      `${asText.length} ${asText.length === 1 ? 'column was' : 'columns were'} imported as text because the values disagree about what they are: ${asText.map((column) => `“${column.name}”`).join(', ')}.`,
    );
  }
  const skipped = inferred.filter((column) => column.type === 'skip');
  if (skipped.length > 0) {
    warnings.push(
      `${skipped.length} empty ${skipped.length === 1 ? 'column was' : 'columns were'} left out: ${skipped.map((column) => `“${column.name}”`).join(', ')}.`,
    );
  }
  if (pages.length > 0) {
    warnings.push(
      `${withPages} of ${table.rows.length} ${table.rows.length === 1 ? 'row has' : 'rows have'} a page, imported as its document.`,
    );
  }
  if (missingPages > 0) {
    warnings.push(
      `${missingPages} ${missingPages === 1 ? 'row had no page file' : 'rows had no page file'} beside the table.`,
    );
  }
  warnings.push(
    'Notion’s relations, formulas, rollups and files are not carried: a database is imported as its own rows.',
  );

  return {
    source: `a Notion database (${collection})`,
    collections: [{ name: collection, icon: null, color: null }],
    tasks,
    events: [],
    warnings,
    properties,
  };
}

// ── Inference ──────────────────────────────────────────────────────────────

interface Inferred {
  /** `skip` for a column with nothing in it. */
  type: PropertyType | 'skip';
  options?: SelectOptionPlan[];
  /** What the values nearly were, when they disagreed. For the warning. */
  wanted?: PropertyType;
}

/**
 * What a column of text is, if the values agree.
 *
 * Order matters: the narrowest reading that every non-empty value satisfies
 * wins, and text is the fallback. A column of `Yes`/`No` is a checkbox; of
 * numbers, a number; of `2026-09-15`, a date; of instants, a datetime; of
 * links, a url. A column whose values repeat within a small vocabulary is a
 * set of choices — multi-select when the values carry commas, select
 * otherwise — but only once there are enough rows for repetition to mean
 * something.
 */
export function infer(raw: readonly string[]): Inferred {
  const values = raw.map((value) => value.trim()).filter((value) => value !== '');
  if (values.length === 0) return { type: 'skip' };

  if (values.every((value) => YES.test(value) || NO.test(value))) return { type: 'checkbox' };
  if (values.every(isNumber)) return { type: 'number' };
  if (values.every((value) => ISO_DATE.test(value))) return { type: 'date' };
  if (values.every(isInstant)) return { type: 'datetime' };
  if (values.every((value) => URL.test(value))) return { type: 'url' };

  // Choices: few distinct values, each seen more than once, none of them prose.
  const multi = values.some((value) => value.includes(','));
  const parts = multi ? values.flatMap(splitList) : values;
  const distinct = [...new Set(parts)];
  const short = distinct.every((value) => value.length <= 40 && !value.includes('\n'));
  if (
    raw.length >= MIN_ROWS_FOR_CHOICES &&
    short &&
    distinct.length <= MAX_OPTIONS &&
    distinct.length < parts.length
  ) {
    return {
      type: multi ? 'multi_select' : 'select',
      options: distinct.map((label) => ({ id: slug(label) || label, label, color: null })),
    };
  }

  // Nearly something: worth saying when a column that looks numeric or dated
  // has one value that is not.
  const nearly = nearlyType(values);
  return nearly === undefined ? { type: 'text' } : { type: 'text', wanted: nearly };
}

/** The value a row stores for an inferred column, or null to store nothing. */
function read(column: Inferred & { name: string }, raw: string): unknown {
  const value = raw.trim();
  if (value === '') return null;
  switch (column.type) {
    case 'checkbox':
      return YES.test(value);
    case 'number':
      return Number(value.replace(/\s/g, '').replace(',', '.'));
    case 'date':
    case 'datetime':
      return column.type === 'date' ? value : new Date(value).toISOString();
    case 'select':
      return column.options?.find((option) => option.label === value)?.id ?? value;
    case 'multi_select':
      return splitList(value).map(
        (part) => column.options?.find((option) => option.label === part)?.id ?? part,
      );
    default:
      return value;
  }
}

function isNumber(value: string): boolean {
  const cleaned = value.replace(/\s/g, '').replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(cleaned) && Number.isFinite(Number(cleaned));
}

function isInstant(value: string): boolean {
  return /\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** What most of a column's values look like, when one spoils it. */
function nearlyType(values: readonly string[]): PropertyType | undefined {
  const most = (predicate: (value: string) => boolean) =>
    values.filter(predicate).length / values.length >= 0.8;
  if (most(isNumber)) return 'number';
  if (most((value) => ISO_DATE.test(value))) return 'date';
  if (most((value) => URL.test(value))) return 'url';
  return undefined;
}

// ── Pages ──────────────────────────────────────────────────────────────────

/**
 * The file for a row: Notion names it `<Title> <hash>.md`, so the match is by
 * prefix. An exact name wins over a prefix, and a title that matches nothing
 * has no page.
 */
export function findPage(
  pages: ReadonlyMap<string, NotionPage>,
  title: string,
): NotionPage | undefined {
  if (title === '') return undefined;
  const exact = pages.get(title);
  if (exact !== undefined) return exact;
  for (const [name, page] of pages) {
    if (!name.startsWith(`${title} `)) continue;
    // What follows is Notion's hash, which has no spaces in it. Without this,
    // "Draft" would take the file belonging to "Draft the brief".
    if (!name.slice(title.length + 1).includes(' ')) return page;
  }
  return undefined;
}

/** The first paragraph of a document, as the row's note. */
function firstParagraph(blocks: ReturnType<typeof fromMarkdown>): string | null {
  const first = blocks.find((block) => block.type === 'paragraph');
  if (first === undefined) return null;
  const text = plainText([first]);
  return text === '' ? null : text;
}
