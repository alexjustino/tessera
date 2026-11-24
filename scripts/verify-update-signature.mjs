// Verify an updater signature the way an installed Tessera will (ADR-062).
//
//   node scripts/verify-update-signature.mjs <installer> <installer.sig> [version]
//
// The public key is read from src-tauri/tauri.conf.json (plugins.updater.pubkey),
// so a release whose secret key does not match the key the copies carry fails
// here, before anything is published, instead of on every machine afterwards.
//
// Both files are minisign documents, base64-encoded by Tauri. A signature is
// Ed25519 over the BLAKE2b-512 digest of the file ("ED"), or over the file
// itself ("Ed", the legacy form); a second, global signature covers the first
// together with the trusted comment, which carries the version it was made for.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The decoded lines of a base64-wrapped minisign document. */
function lines(base64Text) {
  return Buffer.from(base64Text.trim(), 'base64').toString('utf8').split(/\r?\n/);
}

function ed25519Key(raw32) {
  // An Ed25519 SubjectPublicKeyInfo is a fixed 12-byte prefix and the raw key.
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({ key: Buffer.concat([prefix, raw32]), format: 'der', type: 'spki' });
}

/**
 * Check `file` against `signature` (Tauri's base64 .sig text) with `publicKey`
 * (Tauri's base64 pubkey text). Returns the signed version, or throws a sentence.
 */
export function verifyUpdate(file, signature, publicKey, version) {
  const keyLine = lines(publicKey)[1];
  if (keyLine === undefined) throw new Error('the public key is not a minisign key');
  const keyBytes = Buffer.from(keyLine, 'base64');
  if (keyBytes.length !== 42 || keyBytes.subarray(0, 2).toString() !== 'Ed') {
    throw new Error('the public key is not an Ed25519 minisign key');
  }
  const keyId = keyBytes.subarray(2, 10);
  const key = ed25519Key(keyBytes.subarray(10));

  const [, sigLine, trustedLine, globalLine] = lines(signature);
  if (sigLine === undefined || trustedLine === undefined || globalLine === undefined) {
    throw new Error('the signature is not a minisign signature');
  }
  const sigBytes = Buffer.from(sigLine, 'base64');
  if (sigBytes.length !== 74) throw new Error('the signature has the wrong length');
  const algorithm = sigBytes.subarray(0, 2).toString();
  if (!sigBytes.subarray(2, 10).equals(keyId)) {
    throw new Error('the signature was made with another key than the one the copies carry');
  }
  const sig = sigBytes.subarray(10);
  const message =
    algorithm === 'ED' ? createHash('blake2b512').update(file).digest() : Buffer.from(file);
  if (!verify(null, message, key, sig)) throw new Error('the signature does not match the file');

  const prefix = 'trusted comment: ';
  if (!trustedLine.startsWith(prefix)) throw new Error('the signature has no trusted comment');
  const trusted = trustedLine.slice(prefix.length);
  const global = Buffer.from(globalLine, 'base64');
  if (!verify(null, Buffer.concat([sig, Buffer.from(trusted, 'utf8')]), key, global)) {
    throw new Error('the trusted comment does not match its signature');
  }
  const signedVersion = /(?:^|\t)version:([^\t]+)/.exec(trusted)?.[1] ?? null;
  if (version !== undefined && signedVersion !== version) {
    throw new Error(`the signature is for version ${signedVersion}, not ${version}`);
  }
  return signedVersion;
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const [installer, sigFile, version] = process.argv.slice(2);
  if (installer === undefined || sigFile === undefined) {
    console.error('usage: verify-update-signature.mjs <installer> <installer.sig> [version]');
    process.exit(2);
  }
  const config = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  try {
    const signed = verifyUpdate(
      readFileSync(installer),
      readFileSync(sigFile, 'utf8'),
      config.plugins.updater.pubkey,
      version,
    );
    console.log(`verified ${path.basename(installer)}: signed for ${signed}`);
  } catch (error) {
    console.error(`${path.basename(installer)}: ${error.message}`);
    process.exit(1);
  }
}
