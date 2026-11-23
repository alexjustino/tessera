import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SHORTCUTS } from '@/domain/settings';

import { findSection, GUIDE, guideMarkdown, searchGuide, type GuideChapter } from './guide';

const DOC = path.resolve(import.meta.dirname, '..', '..', 'docs', 'USER_GUIDE.md');

describe('the guide', () => {
  it('has unique ids, so a link to a section always lands on one', () => {
    const chapters = GUIDE.map((chapter) => chapter.id);
    expect(new Set(chapters).size).toBe(chapters.length);
    for (const chapter of GUIDE) {
      const sections = chapter.sections.map((section) => section.id);
      expect(new Set(sections).size).toBe(sections.length);
    }
  });

  it('gives every chapter a summary and every section something to read', () => {
    for (const chapter of GUIDE) {
      expect(chapter.summary.length).toBeGreaterThan(10);
      expect(chapter.sections.length).toBeGreaterThan(0);
      for (const section of chapter.sections) expect(section.body.length).toBeGreaterThan(0);
    }
  });

  it('teaches the shortcut quick capture really starts with', () => {
    expect(JSON.stringify(GUIDE)).toContain(SHORTCUTS[0]);
  });

  it('names the palette key the window really listens for', () => {
    const keys = GUIDE.flatMap((chapter) => chapter.sections.flatMap((s) => s.keys ?? []));
    expect(keys.map((key) => key.keys)).toEqual(expect.arrayContaining(['Ctrl+K', 'F1']));
  });
});

describe('searching the guide', () => {
  it('finds a section by words from its text, in any case and with accents', () => {
    const hits = searchGuide('JOURNAL');
    expect(hits.map((hit) => hit.section.id)).toContain('ritual');
    expect(searchGuide('réplan').map((hit) => hit.section.id)).toContain('replan');
  });

  it('needs every word, so more words find less', () => {
    expect(searchGuide('calendar').length).toBeGreaterThan(searchGuide('calendar edge').length);
    expect(searchGuide('calendar edge').map((hit) => hit.section.id)).toEqual(['calendar']);
  });

  it('keeps the guide’s own order', () => {
    const order = searchGuide('settings').map((hit) => hit.chapter.id);
    const positions = order.map((id) => GUIDE.findIndex((chapter) => chapter.id === id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('finds nothing for a blank query: the contents are shown instead', () => {
    expect(searchGuide('   ')).toEqual([]);
  });

  it('finds nothing for words the guide does not hold', () => {
    expect(searchGuide('blockchain')).toEqual([]);
  });

  it('does not find a section by an id that is not in its chapter', () => {
    expect(findSection('notes', 'ritual')).toBeNull();
    expect(findSection('day', 'ritual')?.section.title).toBe('Plan my day, and close it');
  });
});

describe('the guide in the repository', () => {
  it('writes every chapter and section as a heading', () => {
    const md = guideMarkdown();
    for (const chapter of GUIDE) {
      expect(md).toContain(`{#${chapter.id}}`);
      for (const section of chapter.sections) expect(md).toContain(`### ${section.title}`);
    }
  });

  it('writes keys as a table', () => {
    const tiny: GuideChapter[] = [
      {
        id: 'k',
        title: 'Keys',
        summary: 'A chapter of keys.',
        sections: [{ id: 's', title: 'S', body: ['B'], keys: [{ keys: 'Ctrl+K', does: 'Open' }] }],
      },
    ];
    expect(guideMarkdown(tiny)).toContain('| Ctrl+K | Open |');
    expect(guideMarkdown(tiny)).toContain('| ------ | ---- |');
  });

  // The file is generated; this is what stops it drifting from the screen.
  // `npm run guide:doc` writes it.
  it('is the same guide the product shows', () => {
    if (import.meta.env.MODE === 'write-guide') writeFileSync(DOC, guideMarkdown());
    expect(readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n')).toBe(guideMarkdown());
  });
});
