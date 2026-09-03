import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';
import { Keys } from './webdriver';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * Settings and data: a theme that survives a restart, a shortcut that re-binds,
 * a backup that lists, a restore that puts the workspace back, and an export
 * that imports. The acceptance line of the slice — "a restored backup restores
 * everything" — is the third test.
 *
 * File dialogs cannot be driven from WebDriver, so export and import call the
 * same commands the dialogs feed, with a path in a temporary folder.
 */
describe('settings and data', () => {
  let session: Session;
  let scratch: string;

  beforeAll(async () => {
    session = await startSession();
    scratch = await mkdtemp(path.join(tmpdir(), 'tessera-e2e-files-'));
  });

  afterAll(async () => {
    await session?.stop();
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  });

  const invoke = <T>(command: string, args: Record<string, unknown> = {}) =>
    session.driver.executeAsync<T>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );

  const goTo = async (label: string) => {
    const { driver } = session;
    await (await driver.findByXPath(`//nav//button[normalize-space(.)="${label}"]`)).click();
  };

  it('the theme chosen in Settings is applied at once and survives a restart', async () => {
    const { driver } = session;
    await goTo('Settings');
    await driver.waitForText('Kept in your workspace file');
    await (await driver.findByXPath('//*[@role="radio"][normalize-space(.)="dark"]')).click();
    await driver.waitFor('dark applied', async () =>
      (await driver.execute<string | null>(
        'return document.documentElement.getAttribute("data-theme")',
      )) === 'dark'
        ? true
        : null,
    );

    await session.restart();
    await session.driver.waitFor('dark after restart', async () =>
      (await session.driver.execute<string | null>(
        'return document.documentElement.getAttribute("data-theme")',
      )) === 'dark'
        ? true
        : null,
    );
  });

  it('choosing another shortcut re-binds it and Diagnostics agrees', async () => {
    const { driver } = session;
    await goTo('Settings');
    const select = await driver.waitForElement('select[aria-label="Quick capture shortcut"]');
    await driver.execute(
      'const s = arguments[0]; s.value = "Ctrl+Alt+T"; s.dispatchEvent(new Event("change", { bubbles: true }));',
      [{ [ELEMENT]: select.id }],
    );
    await driver.waitForText('Ctrl+Alt+T');
    await session.screenshot('settings');
    await goTo('Diagnostics');
    await driver.waitForText('Ctrl+Alt+T');
  });

  it('a restored backup restores everything', async () => {
    const { driver } = session;
    await goTo('Tasks');
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Before the backup${Keys.ENTER}`);
    await driver.waitForText('Before the backup');

    await goTo('Settings');
    await (await driver.findByXPath('//button[normalize-space(.)="Back up now"]')).click();
    const row = await driver.waitFor('a listed backup', async () => {
      const rows = await driver.findAll('ul[aria-label="Backups"] li');
      return rows.length >= 1 ? rows[0] : null;
    });
    expect(await row.text()).toContain('tessera-');

    // Life after the backup: another task. Tasks remounts, so the line is found again.
    await goTo('Tasks');
    const again = await driver.waitForElement('input[aria-label="New task"]');
    await again.sendKeys(`After the backup${Keys.ENTER}`);
    await driver.waitForText('After the backup');

    await goTo('Settings');
    // Newest first. The first start of the day already took a backup of the
    // empty workspace, so the one to restore is the newest, not the oldest.
    const restore = await driver.waitFor('the Restore control', async () => {
      const buttons = await driver.findAllByXPath(
        '//ul[@aria-label="Backups"]//li[1]//button[normalize-space(.)="Restore"]',
      );
      return buttons[0] ?? null;
    });
    await restore.click();
    const dialog = await driver.waitForElement('[role="dialog"]');
    expect(await dialog.text()).toContain('Replace the workspace with this backup?');
    await (
      await driver.findByXPath(
        '//*[@role="dialog"]//button[normalize-space(.)="Restore this backup"]',
      )
    ).click();
    await driver.waitForText('The workspace was restored');

    await goTo('Tasks');
    await driver.waitForText('Before the backup');
    await driver.waitForGone('After the backup');

    // The safety backup taken before the restore joins the list, beside the
    // start-of-day one and the manual one.
    await goTo('Settings');
    await driver.waitFor('three backups', async () => {
      const rows = await driver.findAll('ul[aria-label="Backups"] li');
      return rows.length >= 3 ? rows : null;
    });
  });

  it('an export imports back into the same workspace', async () => {
    const { driver } = session;
    const file = path.join(scratch, 'tessera.json').replace(/\\/g, '/');
    const exported = await invoke<{ items: number } | { __error: string }>('export_json', {
      path: file,
    });
    expect(exported).toMatchObject({ items: 1 });
    const document = JSON.parse(await readFile(file, 'utf-8')) as { format: string };
    expect(document.format).toBe('tessera-export');

    await goTo('Tasks');
    const input = await driver.waitForElement('input[aria-label="New task"]');
    await input.sendKeys(`Not in the export${Keys.ENTER}`);
    await driver.waitForText('Not in the export');

    const inspected = await invoke<{ items: number }>('import_inspect', { path: file });
    expect(inspected.items).toBe(1);
    const imported = await invoke<{ items: number }>('import_json', { path: file });
    expect(imported.items).toBe(1);

    // The host told every window; the list refetched without a reload.
    await driver.waitForGone('Not in the export');
    await driver.waitForText('Before the backup');
  });

  it('Markdown and iCalendar exports are written where asked', async () => {
    const markdown = path.join(scratch, 'tessera.md').replace(/\\/g, '/');
    const ics = path.join(scratch, 'tessera.ics').replace(/\\/g, '/');
    await invoke('export_markdown', { path: markdown });
    await invoke('export_ics', { path: ics });
    expect(await readFile(markdown, 'utf-8')).toContain('- [ ] Before the backup');
    expect(await readFile(ics, 'utf-8')).toContain('BEGIN:VCALENDAR');
  });

  it('a file that is not an export is refused as a sentence', async () => {
    const bogus = path.join(scratch, 'bogus.json').replace(/\\/g, '/');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(bogus, '{"hello": 1}');
    const result = await invoke<{ __error?: string }>('import_inspect', { path: bogus });
    expect(result.__error).toContain('not a Tessera export');
  });
});
