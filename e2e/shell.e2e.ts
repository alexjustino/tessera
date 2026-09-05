import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * The shell: the window comes up, the rail names every destination, and each
 * one renders a real screen. This is the first thing that must be true of a
 * build before any other claim about it means anything.
 */
describe('shell', () => {
  let session: Session;

  beforeAll(async () => {
    session = await startSession();
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('opens on Tasks with the title bar and the mark', async () => {
    const { driver } = session;
    expect(await driver.title()).toBe('Tessera');
    await driver.waitForElement('input[aria-label="New task"]');
    const mark = await driver.find('header img');
    expect(await mark.attribute('width')).toBe('16');
  });

  it('lists every destination, all of them built', async () => {
    const { driver } = session;
    const buttons = await driver.findAll('nav[aria-label="Main"] button');
    const labels = await Promise.all(buttons.map((b) => b.text()));
    expect(labels.map((l) => l.split('\n')[0])).toEqual([
      'Search',
      'Today',
      'Tasks',
      'Board',
      'Calendar',
      'Reports',
      'Settings',
      'Diagnostics',
      'About',
    ]);
    const disabled = await driver.findAll('nav[aria-label="Main"] button[disabled]');
    expect(disabled.length).toBe(0);
  });

  it.each([
    ['Today', 'input[aria-label="New task"]'],
    ['Board', 'input[aria-label="New task"]'],
    ['Calendar', 'input[aria-label="New task"]'],
    ['Reports', 'h1'],
    ['Settings', 'h1'],
    ['Diagnostics', 'h1'],
    ['About', 'h1'],
    ['Tasks', 'input[aria-label="New task"]'],
  ])('navigates to %s and renders it', async (label, marker) => {
    const { driver } = session;
    const button = await driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`);
    await button.click();
    await driver.waitForElement(marker);
    const current = await driver.findByXPath('//nav//button[@aria-current="page"]');
    expect(await current.text()).toBe(label);
  });

  it('Diagnostics reports the workspace the suite relocated it to', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Diagnostics"]')).click();
    const row = await driver.waitForText('tessera.sqlite3');
    expect(await row.text()).toContain(session.dataDir.split('\\').pop() ?? session.dataDir);
    await driver.waitForText('up to date');
  });
});
