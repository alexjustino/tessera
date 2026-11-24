import { describe, expect, it } from 'vitest';

import { printedDue } from './printing';

describe('a due date on paper', () => {
  it('says the day, and the time when one was set', () => {
    const at = new Date(2026, 10, 24, 15, 30).toISOString();
    const text = printedDue(at);
    expect(text).toContain('24');
    expect(text).toMatch(/15:30|3:30/);
  });

  it('says only the day when the task is due at the end of it', () => {
    const at = new Date(2026, 10, 24, 23, 59).toISOString();
    expect(printedDue(at)).not.toMatch(/23:59|11:59/);
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('says nothing for a task with no date', () => {
    expect(printedDue(null)).toBe('');
  });
});
