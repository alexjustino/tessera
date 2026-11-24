import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * A tour of every screen with a workspace that has been lived in, in both themes.
 *
 * Most defects of looks were found by pictures of real data, never by a test that
 * asked one question: a label pushed off its row, a figure saying 0m, two colours that
 * meant the same thing. This seeds a believable week — lists in colour, late and
 * due tasks with steps and estimates, a meeting, time on the clock, a goal, notes in
 * sections with highlights — and photographs each screen, so a person can look. Each
 * screen must also open without its error panel.
 */
describe('a tour of a lived-in workspace', () => {
  let session: Session;

  const settled = () =>
    session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );

  const goTo = async (label: string) =>
    (await session.driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();

  const setTheme = async (theme: 'light' | 'dark') => {
    const { driver } = session;
    await goTo('Settings');
    await driver.waitForText('Kept in your workspace file');
    await (await driver.findByXPath(`//*[@role="radio"][normalize-space(.)="${theme}"]`)).click();
    await driver.waitFor(`${theme} theme`, async () =>
      (await driver.execute<string | null>(
        'return document.documentElement.getAttribute("data-theme")',
      )) === theme
        ? true
        : null,
    );
  };

  beforeAll(async () => {
    session = await startSession();
    await settled();
    // One script in the page, so the seeding is a few hundred milliseconds, not minutes.
    const result = await session.driver.executeAsync<string>(`
      const done = arguments[arguments.length - 1];
      const call = window.__TAURI_INTERNALS__.invoke;
      const hour = 3600000, day = 24 * hour;
      const at = (offsetDays, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(h, m, 0, 0); return d.toISOString(); };
      const p = (n) => 'V' + String.fromCharCode(98 + n);
      (async () => {
        const work = await call('list_create', { name: 'Work', position: 'W' });
        await call('list_color', { id: work.id, color: 'blue' });
        const home = await call('list_create', { name: 'Home', position: 'X' });
        await call('list_color', { id: home.id, color: 'green' });
        const tasks = [
          ['tasks', 'Renew the passport', -2, 17, 30],
          ['tasks', 'Book the dentist', 0, 18, null],
          [work.id, 'Write the quarterly report', -1, 12, 180],
          [work.id, 'Prepare the design review', 0, 15, 90],
          [work.id, 'Send the invoice to Acme', 1, 10, 20],
          [work.id, 'Plan the next sprint', 3, 9, 120],
          [home.id, 'Fix the kitchen tap', 2, 19, 60],
          [home.id, 'Water the plants', 0, 20, null],
        ];
        const made = {};
        for (const [index, [list, title, offset, h, minutes]] of tasks.entries()) {
          const item = await call('item_create', { item: { collection_id: list, title, position: p(index) } });
          made[title] = item.id;
          await call('item_set_schedule', { id: item.id, schedule: { start_at: null, due_at: at(offset, h), remind_at: null, recurrence_rrule: null, recurrence_mode: null } });
          if (minutes !== null) await call('item_set_plan', { id: item.id, plan: { estimate_minutes: minutes, is_milestone: false } });
        }
        const report = made['Write the quarterly report'];
        for (const [title, position] of [['Gather the numbers', 'a'], ['Draft the summary', 'b'], ['Ask Dana to review', 'c']]) {
          const step = await call('subtask_add', { parentId: report, title, position });
          if (title === 'Gather the numbers') await call('item_set_completed', { id: step.id, completed: true });
        }
        await call('dependency_link', { blockerId: made['Prepare the design review'], blockedId: made['Plan the next sprint'] });
        await call('property_value_set', { itemId: made['Renew the passport'], propertyId: 'tasks.priority', value: 'high' });
        await call('time_entry_add', { itemId: report, startedAt: at(-1, 9), endedAt: at(-1, 10, 30) });
        await call('time_entry_add', { itemId: made['Prepare the design review'], startedAt: at(0, 8), endedAt: at(0, 8, 45) });
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await call('event_create', { event: { calendar_id: 'personal', title: 'Weekly sync', location: null, starts_at_utc: at(0, 10), ends_at_utc: at(0, 11), tz, all_day: false, rrule: 'FREQ=WEEKLY' } });
        await call('event_create', { event: { calendar_id: 'personal', title: 'Lunch with Ana', location: null, starts_at_utc: at(1, 12, 30), ends_at_utc: at(1, 13, 30), tz, all_day: false, rrule: null } });
        await call('time_block_create', { itemId: made['Prepare the design review'], calendarId: 'personal', startsAtUtc: at(0, 14), endsAtUtc: at(0, 15, 30), tz });
        const goal = await call('goal_create', { name: 'Ship the Q4 plan', measure: 'tasks', target: 4, dueDay: null, position: 'V' });
        for (const title of ['Write the quarterly report', 'Prepare the design review', 'Plan the next sprint']) {
          await call('goal_link', { goalId: goal.id, itemId: made[title] });
        }
        const projects = await call('section_create', { name: 'Projects', color: 'purple', position: 'V' });
        await call('section_create', { name: 'Meetings', color: 'teal', position: 'W' });
        const page = await call('page_create', { title: 'Q4 plan', position: 'V' });
        await call('page_file', { id: page.id, sectionId: projects.id });
        const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
        const content = [
          { type: 'heading', attrs: { level: 2 }, content: [text('Goals for the quarter')] },
          { type: 'paragraph', content: [text('Ship the plan by the 20th. '), text('Budget is fixed.', [{ type: 'highlight', attrs: { color: 'yellow' } }])] },
          { type: 'paragraph', attrs: { noteMarker: 'todo', noteDone: true }, content: [text('Gather last quarter numbers')] },
          { type: 'paragraph', attrs: { noteMarker: 'question' }, content: [text('Do we hire before March?')] },
          { type: 'paragraph', attrs: { noteMarker: 'decision' }, content: [text('Keep the release train monthly '), text('agreed with Dana', [{ type: 'highlight', attrs: { color: 'green' } }])] },
        ];
        const creates = content.map((node, index) => ({ id: crypto.randomUUID(), type: node.type, position: p(index), content: node }));
        await call('blocks_apply', { ownerKind: 'page', ownerId: page.id, changes: { creates, updates: [], deletes: [] }, plainText: 'Goals for the quarter', links: [] });
        await call('page_create', { title: 'Loose ideas', position: 'W' });
        return 'seeded';
      })().then(done, (error) => done(JSON.stringify(error)));
    `);
    expect(result).toBe('seeded');
    await session.restart();
    await settled();
  });

  afterAll(async () => {
    await session?.stop();
  });

  const SCREENS = [
    'Today',
    'Tasks',
    'Work',
    'Board',
    'Calendar',
    'Mosaic',
    'Notes',
    'Goals',
    'Review',
    'Reports',
    'Settings',
    'About',
  ] as const;

  for (const theme of ['dark', 'light'] as const) {
    it(`every screen opens, ${theme}`, async () => {
      const { driver } = session;
      await setTheme(theme);
      for (const screen of SCREENS) {
        if (screen === 'Work') {
          await goTo('Tasks');
          await (await driver.find('[role="group"][aria-label="Lists"] [data-list]')).click();
        } else {
          await goTo(screen);
        }
        await driver.waitFor(`${screen} on screen`, async () =>
          (await driver.findAll('main h1')).length > 0 ? true : null,
        );
        // Long enough for lazy screens and their figures to settle.
        await new Promise((resolve) => setTimeout(resolve, 900));
        expect(await driver.findAll('main [data-testid="screen-failed"]'), screen).toEqual([]);
        const failed = await driver.execute<boolean>(
          'return document.body.innerText.includes("This screen could not be shown")',
        );
        expect(failed, screen).toBe(false);
        await session.screenshot(`tour-${theme}-${screen.toLowerCase()}`);
      }
    });
  }
});
