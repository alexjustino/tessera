import { describe, expect, it } from 'vitest';

import { nextWorkingMorning } from './followUp';

const SP = 'America/Sao_Paulo';

describe('the first offer for a follow-up', () => {
  it('is tomorrow at nine', () => {
    // Monday noon in Sao Paulo, UTC-3.
    expect(nextWorkingMorning('2026-11-02T15:00:00.000Z', SP)).toBe('2026-11-03T12:00:00.000Z');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('does not offer a Saturday', () => {
    // Friday noon: Monday, not tomorrow.
    expect(nextWorkingMorning('2026-11-06T15:00:00.000Z', SP)).toBe('2026-11-09T12:00:00.000Z');
  });

  it('does not offer a Sunday', () => {
    expect(nextWorkingMorning('2026-11-07T15:00:00.000Z', SP)).toBe('2026-11-09T12:00:00.000Z');
  });
});
