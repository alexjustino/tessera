import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { GUIDE } from '@/domain/guide';

const HERE = import.meta.dirname;
const SCENE = readFileSync(path.join(HERE, 'GuideScene.tsx'), 'utf8');
const CSS = readFileSync(path.join(HERE, 'scenes.css'), 'utf8');

describe('the guide’s scenes', () => {
  it('draws every scene a section names', () => {
    const named = new Set(GUIDE.flatMap((c) => c.sections.flatMap((s) => s.scene ?? [])));
    for (const scene of named) expect(SCENE).toMatch(new RegExp(`\\b${scene}: \\{\\s*label:`));
  });

  it('plays once: nothing loops', () => {
    expect(CSS).not.toContain('infinite');
  });

  it('cuts every delay under reduced motion, so a scene is never left half drawn', () => {
    const reduced = CSS.slice(CSS.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/animation-delay:\s*0s/);
  });

  // ── Negative case ──────────────────────────────────────────────────────
  // Tailwind publishes a theme colour only when a class uses it, so `--color-tag-teal`
  // is not on the page and a tile drawn with it comes out black. The tag colours
  // themselves, `--tag-*`, are always there.
  it('draws list colours with the tag variables that are always on the page', () => {
    expect(SCENE).not.toContain('--color-tag-');
    expect(SCENE).toContain('var(--tag-');
  });
});
