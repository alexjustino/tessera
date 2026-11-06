import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Notes started from a meeting: one press on an event opens its page, made the first
 * time with when, notes, decisions and follow-ups; the same press later finds it; a
 * follow-up written there is a task paired with the page.
 */
describe('meeting notes', () => {
  let session: Session;

  const invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
    const result = await session.driver.executeAsync<T | { __error: string }>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: String(e) }));',
      [command, args],
    );
    if (result !== null && typeof result === 'object' && '__error' in result) {
      throw new Error(result.__error);
    }
    return result as T;
  };

  const pressText = async (text: string) => {
    const { driver } = session;
    await driver.waitFor(text, async () => {
      const control = await driver.findByXPath(`//button[normalize-space(.)="${text}"]`);
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
      return true;
    });
  };

  const goTo = async (label: string) =>
    (await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();

  const openTheMeeting = async () => {
    const { driver } = session;
    await goTo('Calendar');
    await driver.waitFor('the meeting', async () => {
      const block = await driver.find('button[aria-label="Edit Design review"]');
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: block.id }]);
      return true;
    });
    await driver.waitForElement('[data-testid="block-editor"]');
  };

  const heading = () =>
    session.driver.execute<string>('return document.querySelector("main h1")?.textContent ?? ""');

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    await driver.waitFor('the opening to go', async () =>
      (await driver.findAll('#opening')).length === 0 ? true : null,
    );
    // Today at ten, local time, so the week on screen holds it whatever day this runs.
    const [startsAt, endsAt] = await driver.execute<[string, string]>(
      'const s = new Date(); s.setHours(10, 0, 0, 0); const e = new Date(s); e.setHours(11); return [s.toISOString(), e.toISOString()];',
    );
    await invoke('event_create', {
      event: {
        calendar_id: 'personal',
        title: 'Design review',
        location: null,
        starts_at_utc: startsAt,
        ends_at_utc: endsAt,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        all_day: false,
        rrule: null,
      },
    });
    await session.restart();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('one press on a meeting opens its notes, made with when and three headings', async () => {
    const { driver } = session;
    await openTheMeeting();
    await pressText('Meeting notes');
    await driver.waitFor('the page', async () =>
      (await heading()).startsWith('Design review — ') ? true : null,
    );
    await driver.waitForElement('[data-testid="meeting-line"]');
    const prose = await driver.waitFor('the notes', async () => {
      const found = await driver.find('.tessera-prose');
      return (await found.text()).includes('Follow-ups') ? found : null;
    });
    const text = await prose.text();
    expect(text).toContain('10:00–11:00');
    for (const word of ['Notes', 'Decisions', 'Follow-ups']) expect(text).toContain(word);
    expect(await invoke<unknown[]>('event_pages_list')).toHaveLength(1);
    await session.screenshot('meeting-notes');
  });

  it('a follow-up written there is a task paired with the page', async () => {
    const { driver } = session;
    const prose = await driver.find('.tessera-prose');
    await prose.click();
    await driver.chord(Keys.CONTROL, Keys.END);
    await prose.sendKeys('Send the mock-ups to Dana');
    await (await driver.find('button[aria-label="Follow up on this line"]')).click();
    await driver.waitForElement('input[aria-label="Follow-up task"]');
    await pressText('Add follow-up');
    await driver.waitForElement('button[aria-label="Open the task Send the mock-ups to Dana"]');

    const pages = await invoke<Array<{ id: string; title: string }>>('pages_list');
    const page = pages.find((one) => one.title.startsWith('Design review — '));
    const items = await invoke<Array<{ id: string; title: string }>>('items_list', {
      collectionId: null,
      includeCompleted: true,
    });
    const task = items.find((item) => item.title === 'Send the mock-ups to Dana');
    const pairs = await invoke<Array<{ item_id: string; page_id: string }>>('item_pages_list');
    expect(pairs).toContainEqual({ item_id: task?.id, page_id: page?.id });
  });

  it('the same press later finds the same page, and says so first', async () => {
    const { driver } = session;
    const before = (await invoke<unknown[]>('pages_list')).length;
    await openTheMeeting();
    await pressText('Open meeting notes');
    await driver.waitFor('the page', async () =>
      (await heading()).startsWith('Design review — ') ? true : null,
    );
    await driver.waitForText('Send the mock-ups to Dana');
    expect((await invoke<unknown[]>('pages_list')).length).toBe(before);
  });

  it('the notes and the pair survive a restart', async () => {
    await session.restart();
    expect(await invoke<unknown[]>('event_pages_list')).toHaveLength(1);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('time for a task offers no meeting notes', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const input = await driver.waitForElement('input[placeholder^="Add a task"]');
    await input.sendKeys(`Draft the brief${Keys.ENTER}`);
    await driver.waitForText('Draft the brief');
    const task = (
      await invoke<Array<{ id: string; title: string }>>('items_list', {
        collectionId: null,
        includeCompleted: true,
      })
    ).find((item) => item.title === 'Draft the brief');
    const [startsAt, endsAt] = await driver.execute<[string, string]>(
      'const s = new Date(); s.setHours(14, 0, 0, 0); const e = new Date(s); e.setHours(15); return [s.toISOString(), e.toISOString()];',
    );
    await invoke('time_block_create', {
      itemId: task?.id,
      calendarId: 'personal',
      startsAtUtc: startsAt,
      endsAtUtc: endsAt,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    await session.restart();
    await goTo('Calendar');
    await session.driver.waitFor('the reserved time', async () => {
      const block = await session.driver.find('button[aria-label="Edit Draft the brief"]');
      await session.driver.execute('arguments[0].click()', [{ [ELEMENT]: block.id }]);
      return true;
    });
    await session.driver.waitForElement('[data-testid="block-editor"]');
    expect(
      await session.driver.findAllByXPath('//button[contains(normalize-space(.), "eeting notes")]'),
    ).toEqual([]);
  });
});
