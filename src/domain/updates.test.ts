import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, readSettings } from './settings';
import { describeUpdate, notesPreview } from './updates';

const NOW = '2026-11-07T21:00:00.000Z';

describe('the update check, in words (ADR-062)', () => {
  it('is on by default, and on for a document that has no word on it', () => {
    expect(DEFAULT_SETTINGS.updateCheck).toBe(true);
    expect(readSettings({ theme: 'dark' }).updateCheck).toBe(true);
    expect(readSettings(null).updateCheck).toBe(true);
  });

  it('is off only when the person turned it off', () => {
    expect(readSettings({ updateCheck: false }).updateCheck).toBe(false);
    expect(readSettings({ updateCheck: 'no' }).updateCheck).toBe(true);
  });

  it('says off means no request at all', () => {
    expect(describeUpdate({ kind: 'off' }, NOW)).toBe(
      'Off. Tessera makes no request to the network.',
    );
  });

  it('says when the newest release was last confirmed', () => {
    expect(describeUpdate({ kind: 'newest', checkedAt: '2026-11-07T20:55:00.000Z' }, NOW)).toBe(
      'This is the newest release. Checked 5 min ago.',
    );
  });

  it('names the release that is ready', () => {
    expect(
      describeUpdate(
        {
          kind: 'available',
          found: { version: '1.4.1', notes: null },
          checkedAt: NOW,
        },
        NOW,
      ),
    ).toBe('Tessera 1.4.1 is ready to install.');
  });

  it('says GitHub could not be reached, and when the last answer came', () => {
    expect(describeUpdate({ kind: 'unreachable', checkedAt: null }, NOW)).toBe(
      'GitHub could not be reached. Tessera asks again tomorrow.',
    );
    expect(
      describeUpdate({ kind: 'unreachable', checkedAt: '2026-11-06T20:00:00.000Z' }, NOW),
    ).toBe('GitHub could not be reached. The last answer came yesterday.');
  });

  it('takes whole sentences from notes wrapped over several lines', () => {
    const notes = [
      'The notebook, and the first round of what using it taught. 1.3 could count a week;',
      'the person testing it could not tell where to start.',
      '',
      '### Added',
      '',
      '- **Plan my day, and close it.** Today starts with Your day. In the morning: what was',
      '  left goes to today, tomorrow or done.',
      '- `Lists` in colour.',
    ].join('\r\n');
    expect(notesPreview(notes)).toEqual([
      'The notebook, and the first round of what using it taught. 1.3 could count a week; the person testing it could not tell where to start.',
      'Added',
      'Plan my day, and close it. Today starts with Your day. In the morning: what was left goes to today, tomorrow or done.',
    ]);
    expect(notesPreview(notes, 5)[3]).toBe('Lists in colour.');
  });

  it('shortens an entry too long for the bar, and has nothing to say for no notes', () => {
    const [only] = notesPreview('word '.repeat(80));
    expect(only?.length).toBe(160);
    expect(only?.endsWith('…')).toBe(true);
    expect(notesPreview(null)).toEqual([]);
    expect(notesPreview('   \n\n')).toEqual([]);
  });
});
