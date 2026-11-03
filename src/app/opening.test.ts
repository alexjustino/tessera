import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { remainingMs } from './opening';

const HTML = readFileSync(path.resolve(import.meta.dirname, '..', '..', 'index.html'), 'utf8');

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
    expect(HTML).toContain('prefers-reduced-motion');
  });

  it('never takes a press from the window underneath', () => {
    expect(HTML).toMatch(/#opening\s*\{[^}]*pointer-events:\s*none/);
  });

  it('removes itself if the application never starts', () => {
    expect(HTML).toMatch(/setTimeout[\s\S]*remove\(\)/);
  });

  it('welcomes a first opening, then says the time of day', () => {
    expect(HTML).toContain('Welcome');
    expect(HTML).toContain('Good morning');
  });

  // The rule in DESIGN_SYSTEM: nothing animates in a loop.
  it('does not loop', () => {
    expect(HTML).not.toContain('infinite');
  });
});
