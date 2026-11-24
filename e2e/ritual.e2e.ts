import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, workEveryHour, type Session } from './session';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

interface RawItem {
  id: string;
  title: string;
  due_at: string | null;
  completed_at: string | null;
}

interface RawReview {
  day: string;
  planned_at: string | null;
  closed_at: string | null;
  score: number | null;
  carried: number;
  note: string | null;
}

/**
 * The daily ritual (ADR-061): Plan my day sorts what was left, weighs today and puts its
 * work on the calendar; Close the day moves what was not finished to tomorrow and keeps
 * a line in the journal. The day's record survives as history.
 */
describe('the daily ritual', () => {
  let session: Session;

  const invoke = async <T>(command: string, args: Record<string, unknown> = {}) => {
    const result = await session.driver.executeAsync<T | { __error: string }>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: JSON.stringify(e) }));',
      [command, args],
    );
    if (result !== null && typeof result === 'object' && '__error' in result) {
      throw new Error(result.__error);
    }
    return result as T;
  };

  const press = async (selector: string) => {
    const { driver } = session;
    await driver.waitFor(selector, async () => {
      const control = await driver.find(selector);
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
      return true;
    });
  };

  const pressText = async (text: string, within = '') => {
    const { driver } = session;
    await driver.waitFor(text, async () => {
      const control = await driver.findByXPath(`${within}//button[normalize-space(.)="${text}"]`);
      await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
      return true;
    });
  };

  const tasks = () =>
    invoke<RawItem[]>('items_list', { collectionId: null, includeCompleted: true });
  const today = () =>
    session.driver.execute<string>(
      'const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");',
    );
  const review = async () => {
    const day = await today();
    return (await invoke<RawReview[]>('day_reviews_list', { from: day })).find(
      (one) => one.day === day,
    );
  };

  beforeAll(async () => {
    session = await startSession();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
    // Free time today whatever hour this runs.
    await workEveryHour(session);
    const seeded = await session.driver.executeAsync<string>(`
      const done = arguments[arguments.length - 1];
      const call = window.__TAURI_INTERNALS__.invoke;
      const at = (offset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d.toISOString(); };
      (async () => {
        const rows = [['Renew the passport', -1, 'Va', 30], ['Write the summary', 0, 'Vb', 45], ['Call the bank', 0, 'Vc', 30]];
        for (const [title, offset, position, minutes] of rows) {
          const item = await call('item_create', { item: { collection_id: 'tasks', title, position } });
          await call('item_set_schedule', { id: item.id, schedule: { start_at: null, due_at: at(offset, 23, 30), remind_at: null, recurrence_rrule: null, recurrence_mode: null } });
          await call('item_set_plan', { id: item.id, plan: { estimate_minutes: minutes, is_milestone: false } });
        }
        return 'seeded';
      })().then(done, (e) => done(JSON.stringify(e)));
    `);
    expect(seeded).toBe('seeded');
    await session.restart();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
    await (await session.driver.findByXPath('//nav//button[normalize-space(.)="Today"]')).click();
    await session.driver.waitForElement('[data-testid="ritual"]');
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('Plan my day starts with what was left, and sends it where it is told', async () => {
    const { driver } = session;
    await pressText('Plan my day', '//*[@data-testid="ritual"]');
    await driver.waitForElement('[data-testid="plan-my-day"]');
    await driver.waitForText('due before today');
    await press(
      '[role="radiogroup"][aria-label="What to do with Renew the passport"] [role="radio"]:nth-child(2)',
    );
    await session.screenshot('ritual-plan-left');
    await pressText('Next', '//*[@data-testid="plan-my-day"]');
    await driver.waitForElement('[data-testid="day-weight"]');
    const passport = (await tasks()).find((task) => task.title === 'Renew the passport');
    // Tomorrow, at the same time of day.
    const due = new Date(passport?.due_at ?? '');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(due.getDate()).toBe(tomorrow.getDate());
    expect(due.getHours()).toBe(23);
  });

  it('weighs today against its free time', async () => {
    const { driver } = session;
    const weight = await driver.find('[data-testid="day-weight"]');
    expect(await weight.text()).toMatch(/1h 15m of work, .* free today\./);
    await session.screenshot('ritual-plan-today');
    await pressText('Next', '//*[@data-testid="plan-my-day"]');
  });

  it('puts today’s work on the calendar in one press, and the day is planned', async () => {
    const { driver } = session;
    await driver.waitForElement('ul[aria-label="Blocks to reserve"]');
    await pressText('Reserve 2 blocks', '//*[@data-testid="plan-my-day"]');
    await driver.waitFor('the dialog closed', async () =>
      (await driver.findAll('[data-testid="plan-my-day"]')).length === 0 ? true : null,
    );
    const reserved = await invoke<string[]>('time_blocked_items');
    expect(reserved.length).toBe(2);
    expect((await review())?.planned_at).toBeTruthy();
  });

  it('Close the day moves what is left to tomorrow and keeps a line in the journal', async () => {
    const summary = (await tasks()).find((task) => task.title === 'Write the summary');
    await invoke('item_set_completed', { id: summary?.id, completed: true });
    await session.restart();
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
    await (await session.driver.findByXPath('//nav//button[normalize-space(.)="Today"]')).click();
    await pressText('Close the day', '//*[@data-testid="ritual"]');
    await session.driver.waitForElement('[data-testid="close-the-day"]');
    const done = await session.driver.find('[data-testid="day-done"]');
    expect(await done.text()).toContain('1 task finished');
    await pressText('Next', '//*[@data-testid="close-the-day"]');
    await session.driver.waitForElement('[data-carry]');
    await pressText('Move 1 to tomorrow', '//*[@data-testid="close-the-day"]');
    const line = await session.driver.waitForElement('textarea[aria-label="A line about today"]');
    await line.sendKeys('Good day: the summary went out.');
    await session.screenshot('ritual-close');
    await pressText('Close the day', '//*[@data-testid="close-the-day"]');
    await session.driver.waitFor('the dialog closed', async () =>
      (await session.driver.findAll('[data-testid="close-the-day"]')).length === 0 ? true : null,
    );

    const record = await review();
    expect(record?.closed_at).toBeTruthy();
    expect(record?.carried).toBe(1);
    expect(record?.note).toBe('Good day: the summary went out.');
    const bank = (await tasks()).find((task) => task.title === 'Call the bank');
    expect(new Date(bank?.due_at ?? '').getDate()).not.toBe(new Date().getDate());

    const sections = await invoke<Array<{ id: string; name: string }>>('sections_list');
    const journal = sections.find((section) => section.name === 'Journal');
    const pages =
      await invoke<Array<{ id: string; title: string; section_id: string | null }>>('pages_list');
    const page = pages.find((one) => one.title.startsWith('Journal — '));
    expect(page?.section_id).toBe(journal?.id);
    const blocks = await invoke<unknown[]>('blocks_list', { ownerKind: 'page', ownerId: page?.id });
    expect(JSON.stringify(blocks)).toContain('Good day: the summary went out.');
    await session.driver.waitForText('Closed. Tomorrow starts with what you moved to it.');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  it('a day cannot be recorded for something that is not a day', async () => {
    await expect(invoke('day_planned', { day: 'tomorrow' })).rejects.toThrow();
  });
});
