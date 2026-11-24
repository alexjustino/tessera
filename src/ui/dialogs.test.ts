import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [full] : [];
  });
}

/** Every `<Modal …>` in the product, with the first class list inside it. */
const DIALOGS = sources(SRC)
  .filter((file) => !file.endsWith(path.join('ui', 'Modal.tsx')))
  .flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(/<Modal\b([^>]*)>/g)].map((match) => {
      const after = text.slice(match.index + match[0].length);
      const firstClass = /className="([^"]*)"/.exec(after)?.[1] ?? '';
      return { file: path.relative(SRC, file), bare: /\bbare\b/.test(match[1]!), firstClass };
    });
  });

describe('dialogs', () => {
  it('are found, so this test is about something', () => {
    expect(DIALOGS.length).toBeGreaterThan(8);
  });

  // The owner found the Templates dialog with its words against the border: some
  // dialogs drew their own margin and some none. The frame is the Modal's now.
  it('draw no margin of their own: the Modal gives every one the same', () => {
    const own = DIALOGS.filter((d) => !d.bare && /(^|\s)p[xy]?-\d/.test(d.firstClass));
    expect(own).toEqual([]);
  });

  it('sit on a solid surface that scrolls when the content is tall', () => {
    const modal = readFileSync(path.join(SRC, 'ui', 'Modal.tsx'), 'utf8');
    expect(modal).toContain('bg-card');
    expect(modal).toContain('overflow-y-auto p-5');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  // A translucent panel let the page show through in the dark theme.
  it('are never translucent', () => {
    const modal = readFileSync(path.join(SRC, 'ui', 'Modal.tsx'), 'utf8');
    expect(modal).not.toContain('bg-flyout');
    expect(modal).not.toContain('backdrop-blur');
  });
});
