/**
 * A CSV reader for files other products wrote.
 *
 * RFC 4180 as it is actually practised: fields separated by a comma (or, when
 * the header says so, a semicolon or a tab), quoted with double quotes, a quote
 * inside a quoted field doubled, line breaks allowed inside quotes, and either
 * `\\r\\n` or `\\n` between records. A byte-order mark at the start is skipped.
 *
 * It never throws. A malformed file — an unclosed quote, a ragged row — is read
 * as far as it can be and the rest reported, by line, in `problems`, because an
 * importer that refuses a whole file for one bad row imports nothing, and one
 * that swallows the bad row silently imports garbage (SPEC §4: hostile input).
 */

export interface CsvTable {
  /** The first row, trimmed. Empty when the file was empty. */
  header: string[];
  /** Every following row as an object keyed by header, missing cells as ''. */
  rows: Record<string, string>[];
  /** What could not be read, one sentence each, with the line it happened on. */
  problems: string[];
}

/** The largest text an importer will read; beyond it the file is refused whole. */
export const MAX_CSV_CHARS = 64 * 1024 * 1024;

export function parseCsv(text: string): CsvTable {
  if (text.length > MAX_CSV_CHARS) {
    return { header: [], rows: [], problems: ['The file is too large to be read as a table.'] };
  }
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const separator = detectSeparator(source);

  const records: string[][] = [];
  const problems: string[] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  let line = 1;
  let recordStartLine = 1;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    // A blank line between records is not a record.
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
    // The next record starts on the line after this break.
    recordStartLine = line + 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field === '') {
        quoted = true;
      } else {
        // A quote in the middle of an unquoted field: kept as text, noted once.
        field += char;
      }
    } else if (char === separator) {
      endField();
    } else if (char === '\r') {
      if (source[index + 1] === '\n') index += 1;
      endRecord();
      line += 1;
    } else if (char === '\n') {
      endRecord();
      line += 1;
    } else {
      field += char;
    }
  }
  if (quoted) {
    problems.push(
      `Line ${recordStartLine}: a quoted field is never closed; the rest of the file was read as that field.`,
    );
  }
  if (field !== '' || record.length > 0) endRecord();

  if (records.length === 0) return { header: [], rows: [], problems };

  const header = records[0]!.map((name) => name.trim());
  const rows: Record<string, string>[] = [];
  records.slice(1).forEach((cells, offset) => {
    const row: Record<string, string> = {};
    header.forEach((name, column) => {
      row[name] = (cells[column] ?? '').trim();
    });
    if (cells.length > header.length) {
      problems.push(
        `Row ${offset + 2}: ${cells.length - header.length} more ${cells.length - header.length === 1 ? 'cell' : 'cells'} than the header has; the extra ${cells.length - header.length === 1 ? 'was' : 'were'} left out.`,
      );
    }
    rows.push(row);
  });
  return { header, rows, problems };
}

/** The separator the header uses: whichever of `,` `;` `\\t` splits it most. */
function detectSeparator(source: string): string {
  const firstLine = source.slice(0, source.search(/\r?\n|$/));
  const counts = [',', ';', '\t'].map((candidate) => ({
    candidate,
    count: firstLine.split(candidate).length - 1,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]!.count > 0 ? counts[0]!.candidate : ',';
}

/** A header name looked up without caring about case or surrounding space. */
export function column(row: Record<string, string>, ...names: string[]): string {
  const keys = Object.keys(row);
  for (const wanted of names) {
    const key = keys.find((k) => k.trim().toLowerCase() === wanted.toLowerCase());
    if (key !== undefined) return row[key] ?? '';
  }
  return '';
}

/** True when the header has every one of these columns, case-insensitively. */
export function hasColumns(header: readonly string[], ...names: string[]): boolean {
  const lower = header.map((name) => name.trim().toLowerCase());
  return names.every((name) => lower.includes(name.toLowerCase()));
}
