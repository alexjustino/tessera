import { describe, expect, it } from 'vitest';

import { colorLabel, isColor, nextColor } from './colors';
import {
  checkSectionName,
  orderedSections,
  pageCounts,
  pagesIn,
  positionForNewSection,
  type Section,
} from './sections';

const section = (id: string, name: string, position: string): Section => ({
  id,
  name,
  color: null,
  position,
});

const SECTIONS = [section('p', 'Projects', 'W'), section('c', 'Clients', 'V')];

describe('a section name', () => {
  it('is taken trimmed, and may stay what it is when renamed', () => {
    expect(checkSectionName('  Ideas ', SECTIONS)).toEqual({ status: 'ok', name: 'Ideas' });
    expect(checkSectionName('Projects', SECTIONS, 'p').status).toBe('ok');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('cannot be empty, too long, or another section’s', () => {
    expect(checkSectionName('  ', SECTIONS).status).toBe('invalid');
    expect(checkSectionName('x'.repeat(61), SECTIONS).status).toBe('invalid');
    expect(checkSectionName('projects', SECTIONS).status).toBe('invalid');
  });

  it('cannot be Quick notes, which is always there', () => {
    expect(checkSectionName('quick notes', SECTIONS).status).toBe('invalid');
  });
});

describe('the sections', () => {
  it('are kept in their order, and a new one goes last', () => {
    expect(orderedSections(SECTIONS).map((s) => s.id)).toEqual(['c', 'p']);
    expect(positionForNewSection(SECTIONS) > 'W').toBe(true);
  });

  it('hold their own pages, and Quick notes holds those with none', () => {
    const pages = [
      { id: '1', sectionId: 'p' },
      { id: '2', sectionId: null },
      { id: '3', sectionId: 'p' },
    ];
    expect(pagesIn(pages, 'p').map((page) => page.id)).toEqual(['1', '3']);
    expect(pagesIn(pages, null).map((page) => page.id)).toEqual(['2']);
    expect(pageCounts(pages).get('p')).toBe(2);
    expect(pageCounts(pages).get('')).toBe(1);
  });
});

describe('the colours', () => {
  it('are named, and a new section gets the least used', () => {
    expect(colorLabel('teal')).toBe('Teal');
    expect(colorLabel(null)).toBe('No colour');
    expect(nextColor([])).toBe('red');
    expect(nextColor(['red', 'orange'])).toBe('yellow');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('are only the nine on the list', () => {
    expect(isColor('#ff0000')).toBe(false);
    expect(isColor('blue')).toBe(true);
  });
});
