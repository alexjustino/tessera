import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startSession, type Session } from './session';

/**
 * A copy built without the owner's public key has no updater (ADR-065): Settings
 * says so and where releases are, there is no switch and no Check now, and the
 * host refuses a check before anything leaves the machine.
 *
 * This session runs without the suite's stand-in endpoint, so it is only safe while
 * the bundle carries the placeholder: with a real key it would ask GitHub. It runs
 * only then, and is skipped once the key is in.
 */
const config = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'),
) as { plugins: { updater: { pubkey: string } } };
const placeholder = config.plugins.updater.pubkey.includes('PENDING');

describe.runIf(placeholder)('a copy without an updater', () => {
  let session: Session;

  const invoke = <T>(command: string) =>
    session.driver.executeAsync<T | { __error: string }>(
      'const [command, done] = arguments; window.__TAURI_INTERNALS__.invoke(command, {}).then(done, (e) => done({ __error: e && e.message ? e.message : JSON.stringify(e) }));',
      [command],
    );

  beforeAll(async () => {
    session = await startSession({ updateUrl: '' });
    await session.driver.waitFor('the opening to go', async () =>
      (await session.driver.findAll('#opening')).length === 0 ? true : null,
    );
  });

  afterAll(async () => {
    await session?.stop();
  });

  it('says in Settings that it does not update itself, and where releases are', async () => {
    const { driver } = session;
    await (await driver.findByXPath('//nav//button[normalize-space(.)="Settings"]')).click();
    const status = await driver.waitForElement('[data-testid="update-status"]');
    expect(await status.text()).toContain('This copy does not update itself');
    await driver.findByXPath('//button[normalize-space(.)="Open the Releases page"]');
    await session.screenshot('updates-unshipped');
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('offers no switch and no Check now', async () => {
    const { driver } = session;
    expect(await driver.findAll('[role="switch"][aria-label="Check for updates"]')).toHaveLength(0);
    expect(await driver.findAllByXPath('//button[normalize-space(.)="Check now"]')).toHaveLength(0);
  });

  it('refuses a check in the host, before anything leaves the machine', async () => {
    expect(await invoke<boolean>('update_shipped')).toBe(false);
    const result = await invoke<unknown>('update_check');
    expect(JSON.stringify(result)).toContain('does not update itself');
  });
});
