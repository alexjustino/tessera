import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { remainingMs } from './opening';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'public', 'opening.css'), 'utf8');
const MARK = readFileSync(path.join(ROOT, 'src-tauri', 'icons', 'tessera.svg'), 'utf8');

describe('how long the opening stays', () => {
  it('waits out the rest of its animation', () => {
    expect(remainingMs(300, 1100)).toBe(800);
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('adds no wait once the workspace took longer than the animation', () => {
    expect(remainingMs(5000, 1100)).toBe(0);
  });
});

describe('the page that draws it', () => {
  it('honours a request for less motion itself, before the stylesheet has loaded', () => {
    expect(CSS).toContain('prefers-reduced-motion');
  });

  it('never takes a press from the window underneath', () => {
    expect(CSS).toMatch(/#opening\s*\{[^}]*pointer-events:\s*none/);
  });

  it('removes itself if the application never starts', () => {
    expect(HTML).toMatch(/setTimeout[\s\S]*remove\(\)/);
  });

  it('welcomes a first opening, then says the time of day', () => {
    expect(HTML).toContain('Welcome');
    expect(HTML).toContain('Good morning');
  });

  it('says what Tessera is for the first time, and the date after that', () => {
    expect(HTML).toContain('Tasks, notes and time, tile by tile.');
    expect(HTML).toMatch(/toLocaleDateString\(undefined,\s*\{[^}]*weekday/);
  });

  // One mark (ADR-063): the page draws the file's colours, and its finished tile.
  it('sets the same mark the icon is drawn from', () => {
    const colours = (svg: string) =>
      new Set([...svg.matchAll(/stop-color="(#[0-9a-f]{6})"/gi)].map((m) => m[1]!.toLowerCase()));
    const opening = HTML.slice(HTML.indexOf('<svg'), HTML.indexOf('</svg>'));
    expect(colours(opening)).toEqual(colours(MARK));
    expect(opening).toContain('d="M153 172 L166 185 L190 158"');
    expect(MARK).toContain('d="M153 172 L166 185 L190 158"');
  });

  it('draws the check of the finished tile, after the tiles are set', () => {
    expect(CSS).toMatch(/\.opening-check\s*\{[^}]*stroke-dashoffset/);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  // A <style> here would be hashed into the policy, and a policy with a hash
  // stops every <style> a library adds later. The print suite caught it.
  it('keeps no inline style in the page', () => {
    expect(HTML).not.toContain('<style');
  });

  // The rule in DESIGN_SYSTEM: nothing animates in a loop.
  it('does not loop', () => {
    expect(CSS).not.toContain('infinite');
  });

  // Less motion must not leave the check undrawn: it is shown finished, not hidden.
  it('shows the check already drawn when less motion is asked for', () => {
    const reduced = CSS.slice(CSS.indexOf('prefers-reduced-motion'));
    expect(reduced).toContain('.opening-check');
    expect(reduced).toMatch(/stroke-dashoffset:\s*0/);
  });
});
