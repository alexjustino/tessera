import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(path.join(ROOT, ...parts), 'utf8');

interface Bundle {
  publisher?: string;
  homepage?: string;
  windows?: { webviewInstallMode?: { type?: string } };
}

const config = JSON.parse(read('src-tauri', 'tauri.conf.json')) as { bundle: Bundle };

/** ADR-063: one mark everywhere, and an installer that looks like what it is. */
describe('the mark', () => {
  it('is the same file in the window as in the icon', () => {
    expect(read('src', 'assets', 'mark.svg')).toBe(read('src-tauri', 'icons', 'tessera.svg'));
  });

  it('carries a finished task: the green tile and its check', () => {
    const mark = read('src-tauri', 'icons', 'tessera.svg');
    expect(mark).toContain('id="done"');
    expect(mark).toMatch(/<path d="M153 172 L166 185 L190 158"[^>]*stroke="#ffffff"/);
  });
});

describe('the installer', () => {
  it('names its publisher and its home page, for Installed apps', () => {
    expect(config.bundle.publisher).toBeTruthy();
    expect(config.bundle.homepage).toBe('https://github.com/alexjustino/tessera');
  });

  // ── Negative case ──────────────────────────────────────────────────────
  // An installer that downloads and runs a program is what heuristics distrust.
  it('downloads nothing of its own while installing', () => {
    expect(config.bundle.windows?.webviewInstallMode?.type).toBe('embedBootstrapper');
    expect(config.bundle.windows?.webviewInstallMode?.type).not.toBe('downloadBootstrapper');
  });

  it('publishes a checksum beside every installer of a release', () => {
    const release = read('.github', 'workflows', 'release.yml');
    expect(release).toContain('SHA256SUMS.txt');
    expect(release).toMatch(/Get-FileHash \$file -Algorithm SHA256/);
  });
});
