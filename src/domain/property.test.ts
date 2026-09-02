import { describe, expect, it } from 'vitest';

import {
  checkValue,
  compareValues,
  emptyValue,
  formatDuration,
  formatValue,
  isEmpty,
  isPropertyType,
  optionsOf,
  parseValue,
  parseValueOrEmpty,
  PRIORITY_LEVELS,
  PROPERTY_TYPES,
  serialiseValue,
  type Property,
  type PropertyType,
  type PropertyValue,
} from './property';

function property(type: PropertyType, overrides: Partial<Property> = {}): Property {
  return {
    id: `p-${type}`,
    collectionId: 'tasks',
    key: type,
    name: type,
    type,
    config: {},
    position: 'V',
    isSystem: false,
    ...overrides,
  };
}

const withOptions = (type: PropertyType) =>
  property(type, {
    config: {
      options: [
        { id: 'todo', label: 'To do', color: null, group: 'todo' },
        { id: 'doing', label: 'In progress', color: 'info', group: 'doing' },
        { id: 'done', label: 'Done', color: 'success', group: 'done' },
      ],
    },
  });

/** A representative stored value for each type, used by the round-trip suite. */
const SAMPLES: Record<PropertyType, { property: Property; values: PropertyValue[] }> = {
  text: { property: property('text'), values: ['hello', '', 'acentuação e 日本語'] },
  number: { property: property('number'), values: [0, 42, -7, 3.14159] },
  checkbox: { property: property('checkbox'), values: [true, false] },
  url: { property: property('url'), values: ['https://example.com/a?b=c#d'] },
  select: { property: withOptions('select'), values: ['todo', 'done'] },
  multi_select: { property: withOptions('multi_select'), values: [[], ['todo'], ['todo', 'done']] },
  status: { property: withOptions('status'), values: ['doing'] },
  priority: { property: property('priority'), values: ['urgent', 'low'] },
  date: { property: property('date'), values: ['2026-09-02', '2024-02-29'] },
  datetime: { property: property('datetime'), values: ['2026-09-02T17:30:00.000Z'] },
  duration: { property: property('duration'), values: [0, 30, 1440] },
};

describe('the type list', () => {
  it('recognises exactly the types it declares', () => {
    for (const type of PROPERTY_TYPES) expect(isPropertyType(type)).toBe(true);
    expect(isPropertyType('formula')).toBe(false);
    expect(isPropertyType('')).toBe(false);
    expect(isPropertyType(null)).toBe(false);
    expect(isPropertyType(42)).toBe(false);
  });

  it('has a sample for every declared type', () => {
    // Guards the suite itself: adding a type without a sample would otherwise
    // leave it silently untested, which is the failure mode this file exists
    // to prevent.
    expect(Object.keys(SAMPLES).sort()).toEqual([...PROPERTY_TYPES].sort());
  });
});

describe('round trip', () => {
  // The claim the slice makes: every type survives being written and read back.
  for (const type of PROPERTY_TYPES) {
    const { property: subject, values } = SAMPLES[type];

    it(`${type} survives serialise and parse`, () => {
      for (const value of values) {
        const stored = serialiseValue(subject, value);
        const parsed = parseValue(subject, JSON.parse(stored));

        expect(parsed.status, `${type} value ${JSON.stringify(value)} became unreadable`).toBe(
          'ok',
        );
        if (parsed.status === 'ok') expect(parsed.value).toEqual(value);
      }
    });

    it(`${type} round-trips its empty value`, () => {
      const empty = emptyValue(subject);
      const parsed = parseValue(subject, JSON.parse(serialiseValue(subject, empty)));
      expect(parsed.status).toBe('ok');
      if (parsed.status === 'ok') expect(parsed.value).toEqual(empty);
    });
  }
});

describe('parseValue tolerates history', () => {
  it('reads a missing value as empty rather than failing', () => {
    expect(parseValue(property('text'), null)).toEqual({ status: 'ok', value: null });
    expect(parseValue(property('text'), undefined)).toEqual({ status: 'ok', value: null });
  });

  it('reports a value it cannot understand instead of throwing', () => {
    // One row written by an older build must not blank the screen for every
    // other row, so nothing here is allowed to raise.
    const cases: Array<[PropertyType, unknown]> = [
      ['number', 'not a number'],
      ['number', Number.NaN],
      ['number', Number.POSITIVE_INFINITY],
      ['checkbox', 'yes'],
      ['text', 42],
      ['multi_select', 'todo'],
      ['multi_select', [1, 2]],
      ['date', '2026-9-2'],
      ['date', 'yesterday'],
      ['datetime', 'not a date'],
    ];

    for (const [type, raw] of cases) {
      const result = parseValue(SAMPLES[type].property, raw);
      expect(result.status, `${type} accepted ${JSON.stringify(raw)}`).toBe('unreadable');
      if (result.status === 'unreadable') {
        expect(result.reason).not.toBe('');
        expect(result.raw).toEqual(raw);
      }
    }
  });

  it('keeps an option the property no longer offers', () => {
    // Deleting an option must not silently rewrite everybody's data. Reading is
    // tolerant; only writing is strict.
    const subject = withOptions('select');
    expect(parseValue(subject, 'archived')).toEqual({ status: 'ok', value: 'archived' });
  });

  it('removes duplicates from a multi-select', () => {
    const subject = withOptions('multi_select');
    const result = parseValue(subject, ['todo', 'todo', 'done']);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.value).toEqual(['todo', 'done']);
  });

  it('falls back to empty when asked to', () => {
    expect(parseValueOrEmpty(property('number'), 'nonsense')).toBeNull();
    expect(parseValueOrEmpty(withOptions('multi_select'), 'nonsense')).toEqual([]);
  });

  it('never writes a value it could not read back', () => {
    expect(serialiseValue(property('number'), 'nonsense' as unknown as PropertyValue)).toBe('null');
  });
});

describe('checkValue is strict about new input', () => {
  it('accepts an http or https link and rejects anything else', () => {
    const url = property('url');
    expect(checkValue(url, 'https://example.com')).toEqual({
      status: 'ok',
      value: 'https://example.com',
    });
    expect(checkValue(url, 'not a link').status).toBe('invalid');
    expect(checkValue(url, 'javascript:alert(1)').status).toBe('invalid');
    expect(checkValue(url, 'file:///c:/secrets').status).toBe('invalid');
  });

  it('rejects an option the property does not offer', () => {
    const select = withOptions('select');
    expect(checkValue(select, 'done').status).toBe('ok');
    expect(checkValue(select, 'archived').status).toBe('invalid');
  });

  it('rejects a multi-select containing an unknown option', () => {
    const multi = withOptions('multi_select');
    expect(checkValue(multi, ['todo', 'done']).status).toBe('ok');
    expect(checkValue(multi, ['todo', 'nope']).status).toBe('invalid');
  });

  it('rejects a negative duration', () => {
    expect(checkValue(property('duration'), -5).status).toBe('invalid');
    expect(checkValue(property('duration'), 0).status).toBe('ok');
  });

  it('treats an empty value as clearing the field, for every type', () => {
    for (const type of PROPERTY_TYPES) {
      const subject = SAMPLES[type].property;
      const result = checkValue(subject, null);
      expect(result.status, `${type} refused to be cleared`).toBe('ok');
      if (result.status === 'ok') expect(result.value).toEqual(emptyValue(subject));
    }
  });

  it('treats whitespace-only text as empty', () => {
    expect(checkValue(property('text'), '   ')).toEqual({ status: 'ok', value: null });
  });
});

describe('formatValue', () => {
  it('shows nothing for an empty value', () => {
    for (const type of PROPERTY_TYPES) {
      const subject = SAMPLES[type].property;
      expect(formatValue(subject, emptyValue(subject)), type).toBe('');
    }
  });

  it('shows a checkbox as a word, not as true or false', () => {
    expect(formatValue(property('checkbox'), true)).toBe('Yes');
    expect(formatValue(property('checkbox'), false)).toBe('No');
  });

  it('applies precision and unit to a number', () => {
    const subject = property('number', { config: { precision: 2, unit: 'kg' } });
    expect(formatValue(subject, 3.14159)).toBe('3.14 kg');
  });

  it('shows an option label rather than its identifier', () => {
    expect(formatValue(withOptions('status'), 'doing')).toBe('In progress');
    expect(formatValue(withOptions('multi_select'), ['todo', 'done'])).toBe('To do, Done');
  });

  it('shows an option the property no longer offers as itself', () => {
    // The data is still there. Hiding it is how somebody loses track of what
    // they wrote.
    expect(formatValue(withOptions('select'), 'archived')).toBe('archived');
  });

  it('does not shift a calendar date across the international date line', () => {
    // `new Date('2026-03-15')` is midnight UTC, which is the previous day for
    // anyone west of Greenwich. Parsing the parts avoids the classic off-by-one.
    expect(formatValue(property('date'), '2026-03-15', 'en-GB')).toBe('15 Mar 2026');
    expect(formatValue(property('date'), '2026-01-01', 'en-GB')).toBe('1 Jan 2026');
  });

  it('handles a leap day', () => {
    expect(formatValue(property('date'), '2024-02-29', 'en-GB')).toBe('29 Feb 2024');
  });
});

describe('formatDuration', () => {
  it('writes minutes the way a person says them', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(1440)).toBe('24h');
  });

  it('never shows a negative duration', () => {
    expect(formatDuration(-30)).toBe('0m');
  });
});

describe('compareValues', () => {
  it('sorts empty last, so an unanswered row does not lead the list', () => {
    const subject = property('number');
    expect(compareValues(subject, null, 5)).toBeGreaterThan(0);
    expect(compareValues(subject, 5, null)).toBeLessThan(0);
    expect(compareValues(subject, null, null)).toBe(0);
  });

  it('sorts options by their declared order, not alphabetically', () => {
    // Urgent before High because the property says so, not because U precedes H.
    const subject = property('priority');
    expect(compareValues(subject, 'urgent', 'high')).toBeLessThan(0);
    expect(compareValues(subject, 'low', 'medium')).toBeGreaterThan(0);
  });

  it('sorts an unknown option after every known one', () => {
    const subject = withOptions('select');
    expect(compareValues(subject, 'archived', 'done')).toBeGreaterThan(0);
  });

  it('sorts numbers numerically and dates chronologically', () => {
    expect(compareValues(property('number'), 9, 10)).toBeLessThan(0);
    expect(compareValues(property('date'), '2026-01-02', '2026-01-10')).toBeLessThan(0);
    expect(
      compareValues(property('datetime'), '2026-01-02T23:00:00Z', '2026-01-03T01:00:00Z'),
    ).toBeLessThan(0);
  });

  it('sorts a ticked checkbox before an unticked one', () => {
    expect(compareValues(property('checkbox'), true, false)).toBeLessThan(0);
  });
});

describe('options', () => {
  it('gives priority its built-in scale without configuration', () => {
    expect(optionsOf(property('priority'))).toEqual(PRIORITY_LEVELS);
  });

  it('gives an unconfigured select no options rather than failing', () => {
    expect(optionsOf(property('select'))).toEqual([]);
  });
});

describe('isEmpty', () => {
  it('treats null, blank text and an empty list as empty', () => {
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty('')).toBe(true);
    expect(isEmpty('   ')).toBe(true);
    expect(isEmpty([])).toBe(true);
  });

  it('does not treat zero or false as empty', () => {
    // The classic falsy bug: a duration of zero and an unticked checkbox are
    // answers, not absences.
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty(false)).toBe(false);
  });
});
