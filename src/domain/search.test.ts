import { describe, expect, it } from 'vitest';

import { HIT_CLOSE, HIT_OPEN, splitSnippet, toFtsQuery } from './search';

describe('toFtsQuery', () => {
  it('quotes every token and makes the last one a prefix', () => {
    expect(toFtsQuery('buy milk')).toBe('"buy" "milk"*');
    expect(toFtsQuery('  plumber  ')).toBe('"plumber"*');
  });

  it('never lets query syntax through', () => {
    expect(toFtsQuery('milk OR bread')).toBe('"milk" "OR" "bread"*');
    // Inside double quotes FTS5 reads everything literally, so the operator
    // becomes two ordinary tokens rather than a function call.
    expect(toFtsQuery('NEAR(a b)')).toBe('"NEAR(a" "b"*');
    expect(toFtsQuery('title:milk')).toBe('"title:milk"*');
    expect(toFtsQuery('-milk')).toBe('"milk"*');
    expect(toFtsQuery('^milk')).toBe('"milk"*');
  });

  it('escapes a double quote the FTS5 way', () => {
    expect(toFtsQuery('say "hi"')).toBe('"say" "hi"*');
    expect(toFtsQuery('a"b')).toBe('"a""b"*');
  });

  it('returns null when there is nothing to ask', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('   ')).toBeNull();
    expect(toFtsQuery('"" ** ()')).toBeNull();
    expect(toFtsQuery('--- ...')).toBeNull();
  });

  it('keeps letters from any script and digits', () => {
    expect(toFtsQuery('cláusula 42')).toBe('"cláusula" "42"*');
    expect(toFtsQuery('日本語')).toBe('"日本語"*');
  });
});

describe('splitSnippet', () => {
  const mark = (text: string) => `${HIT_OPEN}${text}${HIT_CLOSE}`;

  it('splits marked runs from plain text', () => {
    expect(splitSnippet(`Buy ${mark('milk')} today`)).toEqual([
      { text: 'Buy ', hit: false },
      { text: 'milk', hit: true },
      { text: ' today', hit: false },
    ]);
  });

  it('handles a snippet that is one hit, or none', () => {
    expect(splitSnippet(mark('milk'))).toEqual([{ text: 'milk', hit: true }]);
    expect(splitSnippet('plain')).toEqual([{ text: 'plain', hit: false }]);
    expect(splitSnippet('')).toEqual([]);
  });

  it('keeps markup as text, never as structure', () => {
    const [only] = splitSnippet('<b>bold</b>');
    expect(only).toEqual({ text: '<b>bold</b>', hit: false });
  });

  it('uses control characters that a person cannot type', () => {
    expect(HIT_OPEN.charCodeAt(0)).toBeLessThan(32);
    expect(HIT_CLOSE.charCodeAt(0)).toBeLessThan(32);
    expect(HIT_OPEN).not.toBe(HIT_CLOSE);
  });
});
