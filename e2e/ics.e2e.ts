import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addLocalDays, startOfWeek } from '../src/domain/calendar';
import { fromIcs } from '../src/domain/importers/ics';
import { redirect } from '../src/domain/importing';
import { sequence } from '../src/domain/ordering';
import { localDay, systemZone } from '../src/domain/schedule';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const FIXTURE = path.resolve(import.meta.dirname, 'fixtures', 'calendar.ics');

/** The clock face this machine shows for an instant — what the grid will say. */
const timeOf = (instant: string) =>
  new Date(instant).toLocaleTimeString(undefined, {
    timeZone: systemZone(),
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * A calendar file, end to end — the slice's proof of done.
 *
 * The fixture holds a weekly 09:00 stand-up in London that runs across both
 * daylight-saving days: the Sunday the clocks go back (2026-10-25) and the
 * Sunday they go forward (2027-03-28). The meeting must stay at 09:00 in
 * London, which means the **instant** moves by an hour — and the grid, in
 * whatever zone this machine is in, must show exactly that hour's difference.
 *
 * The times below are therefore computed, not written down: the expectation is
 * the London wall clock read on this machine, and a build that expanded the
 * rule in UTC would fail it by exactly one hour on two of the four weeks.
 */
describe('a calendar file', () => {
  let session: Session;
  /** The Monday the grid is anchored on, tracked so navigation is arithmetic. */
  let anchoredOn = startOfWeek(localDay(new Date().toISOString(), systemZone()), 1);

  const invoke = <T>(command: string, args: Record<string, unknown> = {}) =>
    session.driver.executeAsync<T>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );

  const goTo = async (label: string) => {
    await (
      await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)
    ).click();
  };

  /** Move the grid to the week holding a day, one arrow click per week. */
  const goToWeekOf = async (day: string) => {
    const target = startOfWeek(day, 1);
    const weeks = Math.round(
      (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${anchoredOn}T00:00:00Z`)) /
        (7 * 86_400_000),
    );
    const label = weeks >= 0 ? 'Next' : 'Previous';
    for (let click = 0; click < Math.abs(weeks); click += 1) {
      const arrow = await session.driver.find(`button[aria-label="${label}"]`);
      await session.driver.execute('arguments[0].click()', [{ [ELEMENT]: arrow.id }]);
    }
    anchoredOn = addLocalDays(anchoredOn, weeks * 7);
  };

  /** The one stand-up on screen, as the grid labels it. */
  const standUps = () => session.driver.findAll('[aria-label^="Stand-up, "]');

  /** Bring an occurrence into view, so a screenshot shows what was asserted. */
  const scrollTo = async (element: { id: string }) => {
    await session.driver.execute('arguments[0].scrollIntoView({ block: "center" })', [
      { [ELEMENT]: element.id },
    ]);
  };

  beforeAll(async () => {
    session = await startSession();
    await session.driver.waitForElement('input[aria-label="New task"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('imports the series, its exception and the occurrence that moved', async () => {
    const text = await invoke<string>('import_read_text', { path: FIXTURE });
    // The task goes where the list looks; the events go to the calendar.
    const plan = redirect(fromIcs(text, 'calendar', systemZone())!, 'Tasks');

    // Three events — the series, an all-day closure and a one-hour review —
    // one task, and two occurrences of the series that do not follow the rule.
    expect(plan.events.map((event) => event.title)).toEqual([
      'Stand-up',
      'Office closed',
      'Quarterly review',
    ]);
    expect(plan.events[0]!.exceptions).toHaveLength(2);
    expect(plan.tasks.map((task) => task.title)).toEqual(['Renew the passport']);

    const taskPositions = sequence(null, null, plan.tasks.length);
    const batch = await invoke<
      { summary: { events: number; tasks: number; exceptions: number } } | { __error: string }
    >('import_apply', {
      plan: {
        source: plan.source,
        collections: plan.collections.map((collection) => ({ ...collection, position: 'zz' })),
        properties: [],
        tasks: plan.tasks.map((task, index) => ({
          collection: task.collection,
          title: task.title,
          notes: task.notes,
          position: taskPositions[index]!,
          start_at: task.startAt,
          due_at: task.dueAt,
          completed_at: task.completedAt,
          estimate_minutes: task.estimateMinutes,
          is_milestone: task.isMilestone,
          values: task.values,
          blocks: [],
        })),
        events: plan.events.map((event) => ({
          title: event.title,
          starts_at: event.startsAt,
          ends_at: event.endsAt,
          tz: event.tz,
          all_day: event.allDay,
          rrule: event.rrule,
          exceptions: (event.exceptions ?? []).map((exception) => ({
            original_start: exception.originalStart,
            kind: exception.kind,
            starts_at: exception.startsAt,
            ends_at: exception.endsAt,
          })),
        })),
      },
    });
    if ('__error' in batch) throw new Error(`import_apply refused: ${batch.__error}`);
    expect(batch.summary).toMatchObject({ events: 3, tasks: 1, exceptions: 2 });
  });

  it('stays at nine in London across the day the clocks go back', async () => {
    await goTo('Calendar');
    await (await session.driver.findByXPath('//button[normalize-space(.)="Week"]')).click();

    // 09:00 in London is 08:00 UTC in summer and 09:00 UTC in winter.
    await goToWeekOf('2026-10-20');
    const before = await standUps();
    expect(before).toHaveLength(1);
    expect(await before[0]!.attribute('aria-label')).toBe(
      `Stand-up, ${timeOf('2026-10-20T08:00:00.000Z')} to ${timeOf('2026-10-20T08:30:00.000Z')}`,
    );

    await goToWeekOf('2026-10-27');
    const after = await standUps();
    expect(after).toHaveLength(1);
    expect(await after[0]!.attribute('aria-label')).toBe(
      `Stand-up, ${timeOf('2026-10-27T09:00:00.000Z')} to ${timeOf('2026-10-27T09:30:00.000Z')}`,
    );
    await scrollTo(after[0]!);
    await session.screenshot('ics-clocks-back');
  });

  it('and across the day they go forward, five months later', async () => {
    await goToWeekOf('2027-03-23');
    const before = await standUps();
    expect(await before[0]!.attribute('aria-label')).toBe(
      `Stand-up, ${timeOf('2027-03-23T09:00:00.000Z')} to ${timeOf('2027-03-23T09:30:00.000Z')}`,
    );

    await goToWeekOf('2027-03-30');
    const after = await standUps();
    expect(await after[0]!.attribute('aria-label')).toBe(
      `Stand-up, ${timeOf('2027-03-30T08:00:00.000Z')} to ${timeOf('2027-03-30T08:30:00.000Z')}`,
    );
  });

  it('the moved Tuesday is at its new time and the cancelled one is not there', async () => {
    await goToWeekOf('2026-11-03');
    const moved = await standUps();
    expect(moved).toHaveLength(1);
    expect(await moved[0]!.attribute('aria-label')).toBe(
      `Stand-up, ${timeOf('2026-11-03T15:00:00.000Z')} to ${timeOf('2026-11-03T15:30:00.000Z')}`,
    );
    await scrollTo(moved[0]!);
    await session.screenshot('ics-moved');

    await goToWeekOf('2026-11-24');
    expect(await standUps()).toHaveLength(0);
    // The week is not empty by accident: the one before it still has its own.
    await goToWeekOf('2026-11-17');
    expect(await standUps()).toHaveLength(1);
  });

  it('reads back what this product writes, and says what that file does not carry', async () => {
    // Tessera exports iCalendar itself (Settings → Export iCalendar), so the
    // reader has one file it can be held to: the product's own.
    const written = path.join(session.dataDir, 'roundtrip.ics');
    const failure = await invoke<null | { __error: string }>('export_ics', { path: written });
    if (failure !== null && typeof failure === 'object' && '__error' in failure) {
      throw new Error('export_ics refused: ' + failure.__error);
    }

    const back = fromIcs(
      await invoke<string>('import_read_text', { path: written }),
      'Tessera',
      systemZone(),
    )!;
    expect(back.events.map((event) => event.title).sort()).toEqual([
      'Office closed',
      'Quarterly review',
      'Stand-up',
    ]);

    const standUp = back.events.find((event) => event.title === 'Stand-up')!;
    expect(standUp.rrule).toBe('FREQ=WEEKLY;BYDAY=TU');
    // The instant survives; the zone does not — the export writes UTC with no
    // TZID, so a re-read event is read in the workspace's zone. It is the same
    // moment, and it would drift by an hour after a change of clocks. Worth
    // knowing, and not this slice's to change: the export is a shipped format.
    expect(standUp.startsAt).toBe('2026-10-06T08:00:00.000Z');
    expect(standUp.tz).toBe(systemZone());
    // The cancelled Tuesday is carried; the moved one is not — the exporter
    // writes EXDATE and has no second VEVENT for an occurrence that moved.
    expect(standUp.exceptions).toEqual([
      {
        originalStart: '2026-11-24T09:00:00.000Z',
        kind: 'cancelled',
        startsAt: null,
        endsAt: null,
      },
    ]);

    // The dated task comes back as a task.
    expect(back.tasks.map((task) => task.title)).toContain('Renew the passport');
  });

  it('undo takes the series, its exceptions and the task with it', async () => {
    const { driver } = session;
    await goTo('Settings');
    const undo = await driver.waitFor('the Undo control', () =>
      driver.find('button[aria-label^="Undo the import"]'),
    );
    // The card is below the fold on Settings: scroll to it, or the artefact
    // photographs the top of the page instead of the thing it is evidence of.
    await scrollTo(undo);
    await driver.waitForText('Calendar (ICS)…');
    await session.screenshot('ics-settings-card');
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: undo.id }]);
    await driver.waitForText('Nothing has been imported yet');

    const exceptions = await invoke<unknown[]>('event_exceptions_list');
    expect(exceptions).toEqual([]);

    await goTo('Calendar');
    await goToWeekOf('2026-11-17');
    expect(await standUps()).toHaveLength(0);
    await driver.chord(Keys.ESCAPE);
  });
});
