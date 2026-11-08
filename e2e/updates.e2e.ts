import { createServer, type Server } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

/**
 * The update check (ADR-062), against a listener on this machine that counts who
 * knocks. It speaks no TLS, so every check ends unreachable, which is the answer
 * an offline machine gets; what it proves is whether Tessera asked at all. With the
 * setting on, it asks when it starts and when Check now is pressed. With it off,
 * nothing leaves, not even when the host is asked directly.
 */
describe('the update check', () => {
  let session: Session;
  let listener: Server;
  let knocks = 0;

  const invoke = <T>(command: string, args: Record<string, unknown> = {}) =>
    session.driver.executeAsync<T | { __error: string }>(
      'const [command, args, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, args).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command, args],
    );

  const opened = async () => {
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
  };

  const toSettings = async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Settings"]')).click();
    await driver.waitForElement('[data-testid="update-status"]');
  };

  const status = async () => (await session.driver.find('[data-testid="update-status"]')).text();

  const click = async (xpath: string) => {
    const { driver } = session;
    const control = await driver.findByXPath(xpath);
    await driver.execute('arguments[0].click()', [{ [ELEMENT]: control.id }]);
  };

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    listener = createServer((socket) => {
      knocks += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const address = listener.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    session = await startSession({
      updateUrl: `https://127.0.0.1:${address.port}/latest.json`,
    });
    await opened();
  });

  afterAll(async () => {
    await session?.stop();
    await new Promise((resolve) => listener?.close(resolve));
  });

  it('asks when Tessera starts, and says so when the answer does not come', async () => {
    const { driver } = session;
    await driver.waitFor('the check at start', async () => (knocks > 0 ? true : null));
    await toSettings();
    await driver.waitFor('the unreachable answer', async () =>
      (await status()).startsWith('GitHub could not be reached') ? true : null,
    );
    // Offline is an answer, not an alarm: no bar offers anything.
    expect(await driver.findAll('[data-testid="update-bar"]')).toHaveLength(0);
    await session.screenshot('updates-unreachable');
  });

  it('asks again when Check now is pressed', async () => {
    const { driver } = session;
    const before = knocks;
    await click('//button[normalize-space(.)="Check now"]');
    await driver.waitFor('a second check', async () => (knocks > before ? true : null));
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('there is nothing to install before a check has found something', async () => {
    const refused = await invoke<unknown>('update_install');
    expect(JSON.stringify(refused)).toContain('no update waiting');
  });

  it('turned off, asks nothing, not at start and not when the host is asked', async () => {
    const { driver } = session;
    await click('//button[@role="switch"][@aria-label="Check for updates"]');
    await driver.waitFor('the setting saved', async () => {
      const saved = await invoke<{ update_check: boolean }>('settings_get');
      return 'update_check' in saved && !saved.update_check ? true : null;
    });
    expect(await status()).toBe('Off. Tessera makes no request to the network.');

    const before = knocks;
    await session.restart();
    await opened();
    await toSettings();
    expect(await status()).toBe('Off. Tessera makes no request to the network.');
    const checkNow = await session.driver.findByXPath('//button[normalize-space(.)="Check now"]');
    expect(await checkNow.attribute('disabled')).not.toBeNull();

    // The host refuses, so the setting holds whatever the window does.
    const refused = await invoke<unknown>('update_check');
    expect(JSON.stringify(refused)).toContain('turned off');
    // Nor will it download one: the switch covers the install as well.
    const install = await invoke<unknown>('update_install');
    expect(JSON.stringify(install)).toContain('turned off');

    // Long enough for a check at start to have knocked, had there been one.
    await pause(5_000);
    expect(knocks).toBe(before);
    await session.screenshot('updates-off');
  });
});
