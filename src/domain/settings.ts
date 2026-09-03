/**
 * Settings: what a person can change about the product, and the shape it is
 * kept in.
 *
 * The host stores one JSON document and validates it; this is the interface's
 * side of the same contract — the same closed lists, so a control never offers
 * a value the host would refuse. `readSettings` never throws: a document the
 * interface does not understand yields the defaults, and the screen opens.
 */

export type Theme = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
export const DENSITIES: readonly Density[] = ['comfortable', 'compact'];

/**
 * The combinations quick capture may be bound to. Mirrors the host's list; the
 * host is the authority and rejects anything else.
 */
export const SHORTCUTS = [
  'Ctrl+Alt+Space',
  'Ctrl+Alt+T',
  'Ctrl+Shift+Space',
  'Ctrl+Alt+N',
] as const;
export type Shortcut = (typeof SHORTCUTS)[number];

export const MAX_BACKUPS_KEPT = 50;

export interface Settings {
  theme: Theme;
  density: Density;
  quickCaptureShortcut: Shortcut;
  backupsEnabled: boolean;
  backupsKeep: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  density: 'comfortable',
  quickCaptureShortcut: 'Ctrl+Alt+Space',
  backupsEnabled: true,
  backupsKeep: 7,
};

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Read whatever came from the host into a `Settings`, field by field. */
export function readSettings(raw: unknown): Settings {
  const source = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const keep = Number(source.backupsKeep);
  return {
    theme: oneOf(THEMES, source.theme, DEFAULT_SETTINGS.theme),
    density: oneOf(DENSITIES, source.density, DEFAULT_SETTINGS.density),
    quickCaptureShortcut: oneOf(
      SHORTCUTS,
      source.quickCaptureShortcut,
      DEFAULT_SETTINGS.quickCaptureShortcut,
    ),
    backupsEnabled:
      typeof source.backupsEnabled === 'boolean'
        ? source.backupsEnabled
        : DEFAULT_SETTINGS.backupsEnabled,
    backupsKeep:
      Number.isInteger(keep) && keep >= 1 && keep <= MAX_BACKUPS_KEPT
        ? keep
        : DEFAULT_SETTINGS.backupsKeep,
  };
}

/** `1.2 MB`, `340 KB`, `12 bytes`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * How old a backup is, in words a person reads at a glance.
 *
 * "Just now" under a minute; minutes under an hour; hours under a day; then
 * days. Coarse on purpose — a backup's age is a reassurance, not a timestamp.
 */
export function describeAge(takenAt: string, now: string): string {
  const ms = new Date(now).getTime() - new Date(takenAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
