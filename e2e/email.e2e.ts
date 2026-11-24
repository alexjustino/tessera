import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/** One part of a message, decoded. */
function partOf(eml: string, type: string): string {
  const head = `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
  const start = eml.indexOf(head) + head.length;
  const end = eml.indexOf('\r\n--', start);
  return Buffer.from(eml.slice(start, end).replace(/\s/g, ''), 'base64').toString('utf8');
}

/**
 * Notes become a draft the person's own mail program opens. Tessera writes the
 * file and never sends anything. Under test it writes to the suite's folder and
 * opens nothing, so nothing appears on the machine running this.
 */
describe('an email draft from a page', () => {
  let session: Session;

  const drafts = async () => {
    const folder = path.join(session.dataDir, 'email-drafts');
    const names = await readdir(folder).catch(() => [] as string[]);
    return names.filter((name) => name.endsWith('.eml')).map((name) => path.join(folder, name));
  };

  const prose = () => session.driver.find('.tessera-prose');

  const press = async () =>
    (await session.driver.find('button[aria-label="Draft an email from this"]')).click();

  beforeAll(async () => {
    session = await startSession();
    const { driver } = session;
    await driver.waitForElement('nav[aria-label="Main"]');
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Notes"]')).click();
    await (await driver.findByXPath('//button[normalize-space(.)="New page"]')).click();
    await driver.waitForElement('.tessera-prose');
    await (await prose()).click();
    await (await prose()).sendKeys('Reunião com a Nozomi');
    await driver.chord(Keys.CONTROL, '3');
    await driver.waitForElement('.tessera-prose [data-note-marker="question"]');
    await (await prose()).sendKeys(`${Keys.ENTER}Second line`);
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('writes a draft of the whole page, with nobody on it', async () => {
    const { driver } = session;
    await press();
    await driver.waitFor('a draft', async () => ((await drafts()).length === 1 ? true : null));
    const [file] = await drafts();
    const eml = await readFile(file as string, 'utf8');
    expect(eml.startsWith('X-Unsent: 1\r\n')).toBe(true);
    expect(eml).not.toContain('\r\nTo:');

    const html = partOf(eml, 'text/html');
    expect(html).toContain('<p>Hi,</p>');
    expect(html).toContain('<strong>Question:</strong> Reunião com a Nozomi');
    expect(html).toContain('Second line');
    expect(html).not.toContain('data-note');
    expect(partOf(eml, 'text/plain')).toContain('Reunião com a Nozomi');
  });

  it('writes only what is selected, when something is', async () => {
    const { driver } = session;
    const line = await driver.find('.tessera-prose [data-note-marker="question"]');
    await driver.execute(
      `const range = document.createRange();
       range.selectNodeContents(arguments[0]);
       const selection = window.getSelection();
       selection.removeAllRanges();
       selection.addRange(range);`,
      [{ [ELEMENT]: line.id }],
    );
    const before = (await drafts()).length;
    await press();
    await driver.waitFor('a second draft', async () =>
      (await drafts()).length === before + 1 ? true : null,
    );
    const newest = (await drafts()).sort().at(-1) as string;
    const html = partOf(await readFile(newest, 'utf8'), 'text/html');
    expect(html).toContain('Reunião com a Nozomi');
    expect(html).not.toContain('Second line');
  });

  it('adds the follow-ups of the page, with their dates', async () => {
    const { driver } = session;
    const body = await prose();
    await body.click();
    await (await driver.find('button[aria-label="Follow up on this line"]')).click();
    await (await driver.findByXPath('//button[normalize-space(.)="Add follow-up"]')).click();
    await driver.waitFor('the pair', async () =>
      (await driver.findAll('button[aria-label^="Open the task "]')).length === 1 ? true : null,
    );
    const before = (await drafts()).length;
    await press();
    await driver.waitFor('a third draft', async () =>
      (await drafts()).length === before + 1 ? true : null,
    );
    const newest = (await drafts()).sort().at(-1) as string;
    expect(partOf(await readFile(newest, 'utf8'), 'text/html')).toContain('<h3>Follow-ups</h3>');
  });
});
