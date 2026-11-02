import { getCurrentWindow } from '@tauri-apps/api/window';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyTheme } from './theme';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }));

/** The little of the root element `applyTheme` touches: this suite runs under node. */
function fakeRoot() {
  const attributes = new Map<string, string>();
  return {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
}

describe('applyTheme', () => {
  const setTheme = vi.fn<(theme: string | null) => Promise<void>>();
  let root: ReturnType<typeof fakeRoot>;

  beforeEach(() => {
    root = fakeRoot();
    vi.stubGlobal('document', { documentElement: root });
    setTheme.mockReset().mockResolvedValue(undefined);
    vi.mocked(getCurrentWindow).mockReset();
    vi.mocked(getCurrentWindow).mockReturnValue({ setTheme } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tells the window the choice, because Windows paints Mica in the window theme', () => {
    applyTheme('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(setTheme).toHaveBeenLastCalledWith('light');

    applyTheme('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(setTheme).toHaveBeenLastCalledWith('dark');
  });

  it('hands the window back to the desktop on system', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(root.getAttribute('data-theme')).toBeNull();
    expect(setTheme).toHaveBeenLastCalledWith(null);
  });

  // ── Negative cases ─────────────────────────────────────────────────────
  it('still applies the theme to the page when there is no host', () => {
    vi.mocked(getCurrentWindow).mockImplementation(() => {
      throw new Error('no host');
    });
    expect(() => applyTheme('dark')).not.toThrow();
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('still applies the theme to the page when the window refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setTheme.mockRejectedValue(new Error('refused'));
    applyTheme('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledOnce();
    });
    warn.mockRestore();
  });
});
