import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyUpdate } from './verify-update-signature.mjs';

/**
 * Minisign documents made here, with a key that exists only for this test, in the
 * shape Tauri writes them: so the check the release runs is itself checked, and no
 * key of any kind lives in the repository.
 */
function pair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  const keyId = randomBytes(8);
  const pub = Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64');
  const publicText = Buffer.from(`untrusted comment: test key\n${pub}\n`).toString('base64');
  const signFile = (file, version, id = keyId) => {
    const sig = sign(null, createHash('blake2b512').update(file).digest(), privateKey);
    const trusted = `timestamp:1794097404\tfile:Tessera_setup.exe\tversion:${version}`;
    const global = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
    const text = [
      'untrusted comment: signature from tauri secret key',
      Buffer.concat([Buffer.from('ED'), id, sig]).toString('base64'),
      `trusted comment: ${trusted}`,
      global.toString('base64'),
      '',
    ].join('\n');
    return Buffer.from(text).toString('base64');
  };
  return { publicText, signFile };
}

describe('an update signature, checked as an installed copy checks it (ADR-062)', () => {
  const file = Buffer.from('the installer');

  it('verifies, and says the version it was signed for', () => {
    const { publicText, signFile } = pair();
    expect(verifyUpdate(file, signFile(file, '1.4.1'), publicText, '1.4.1')).toBe('1.4.1');
  });

  it('refuses a file that is not the one signed', () => {
    const { publicText, signFile } = pair();
    expect(() => verifyUpdate(Buffer.from('another'), signFile(file, '1.4.1'), publicText)).toThrow(
      'does not match the file',
    );
  });

  it('refuses a signature for another version', () => {
    const { publicText, signFile } = pair();
    expect(() => verifyUpdate(file, signFile(file, '1.3.0'), publicText, '1.4.1')).toThrow(
      'for version 1.3.0, not 1.4.1',
    );
  });

  it('refuses a key that is not the one the copies carry', () => {
    const ours = pair();
    const theirs = pair();
    expect(() => verifyUpdate(file, theirs.signFile(file, '1.4.1'), ours.publicText)).toThrow(
      'another key',
    );
  });

  it('refuses the placeholder the repository holds until the owner sets the key', () => {
    const { signFile } = pair();
    expect(() => verifyUpdate(file, signFile(file, '1.4.1'), 'OWNER-PUBLIC-KEY-PENDING')).toThrow();
  });
});
