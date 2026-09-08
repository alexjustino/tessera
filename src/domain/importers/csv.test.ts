import { describe, expect, it } from 'vitest';

import { column, hasColumns, parseCsv } from './csv';

describe('reading a CSV', () => {
  it('reads plain rows keyed by the header', () => {
    const table = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
    expect(table.header).toEqual(['a', 'b', 'c']);
    expect(table.rows).toEqual([
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
    expect(table.problems).toEqual([]);
  });

  it('handles quotes, doubled quotes, separators and line breaks inside them', () => {
    const table = parseCsv('title,notes\r\n"Buy, then pay","She said ""now""\nand left"\r\n');
    expect(table.rows).toEqual([{ title: 'Buy, then pay', notes: 'She said "now"\nand left' }]);
  });

  it('skips a byte-order mark and blank lines, and pads short rows', () => {
    const table = parseCsv('﻿a,b\n\n1\n\n2,3\n');
    expect(table.header).toEqual(['a', 'b']);
    expect(table.rows).toEqual([
      { a: '1', b: '' },
      { a: '2', b: '3' },
    ]);
  });

  it('uses the separator the header uses', () => {
    expect(parseCsv('a;b\n1;2\n').rows).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv('a\tb\n1\t2\n').rows).toEqual([{ a: '1', b: '2' }]);
    // A comma inside a quoted field does not fool the detection of semicolons.
    expect(parseCsv('a;b\n"1,5";2\n').rows).toEqual([{ a: '1,5', b: '2' }]);
  });

  it('never throws: an unclosed quote and a ragged row are reported by line', () => {
    const ragged = parseCsv('a,b\n1,2,3\n');
    expect(ragged.rows).toEqual([{ a: '1', b: '2' }]);
    expect(ragged.problems).toEqual([
      'Row 2: 1 more cell than the header has; the extra was left out.',
    ]);

    const unclosed = parseCsv('a,b\n1,"open\n2,3\n');
    expect(unclosed.rows).toHaveLength(1);
    expect(unclosed.problems[0]).toMatch(/^Line 2: a quoted field is never closed/);
  });

  it('is empty rather than wrong for an empty file, and refuses an absurd one', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [], problems: [] });
    const huge = parseCsv('x'.repeat(64 * 1024 * 1024 + 1));
    expect(huge.rows).toEqual([]);
    expect(huge.problems[0]).toMatch(/too large/);
  });

  it('looks columns up without caring about case or space', () => {
    const row = { ' Due Date ': '2026-09-10', Subject: 'Pay' };
    expect(column(row, 'due date')).toBe('2026-09-10');
    expect(column(row, 'missing', 'subject')).toBe('Pay');
    expect(column(row, 'nothing')).toBe('');
    expect(hasColumns([' Due Date ', 'Subject'], 'subject', 'DUE DATE')).toBe(true);
    expect(hasColumns(['Subject'], 'subject', 'priority')).toBe(false);
  });
});
