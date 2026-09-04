/**
 * The command palette's ranking: which commands a few typed letters mean.
 *
 * Pure. The palette itself is a screen; what it shows for "tod" is a rule, and
 * a rule can be tested without a window. The scoring is deliberately simple —
 * a subsequence match with bonuses for hitting the start of a word — because a
 * palette has a few dozen commands, not a corpus, and a person types two or
 * three letters and expects the obvious answer first.
 */

export type CommandGroup = 'navigate' | 'create' | 'reminders' | 'appearance';

export const GROUP_LABELS: Record<CommandGroup, string> = {
  navigate: 'Go to',
  create: 'Create',
  reminders: 'Reminders',
  appearance: 'Appearance',
};

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** Words that should also find this command, beyond its title. */
  keywords?: readonly string[];
  /** A shortcut to show beside the title, e.g. `Ctrl+N`. Display only. */
  shortcut?: string;
}

export interface RankedCommand {
  command: Command;
  score: number;
  /** Indices into `command.title` that matched, for highlighting. */
  matched: readonly number[];
}

const WORD_START = 8;
const CONSECUTIVE = 4;
const TITLE_PREFIX = 10;
const KEYWORD_HIT = 6;
const GAP_PENALTY = 1;

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const before = text.charAt(index - 1);
  return before === ' ' || before === '-' || before === '/' || before === ':';
}

/**
 * Match `query` as a subsequence of `text`.
 *
 * The first letter is tried from every word it could start, and the best
 * result wins — so "tas" lands on the T of Tasks in "Go to Tasks" rather than
 * on the t of "to". After that each letter takes the nearest occurrence,
 * except that a letter which is not continuing a run and could land on the
 * start of a later word does so, which is what makes "gb" reach "Go to Board"
 * on the B of Board. Returns null when the letters are not all there, in
 * order. Case-insensitive; whitespace in the query is ignored so "go bo" and
 * "gobo" behave alike.
 */
function subsequence(query: string, text: string): { score: number; matched: number[] } | null {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (needle.length === 0) return { score: 0, matched: [] };

  const hay = text.toLowerCase();
  const head = needle.charAt(0);
  let best: { score: number; matched: number[] } | null = null;

  for (let start = hay.indexOf(head); start !== -1; start = hay.indexOf(head, start + 1)) {
    if (best !== null && !isWordStart(hay, start)) continue;
    const attempt = subsequenceFrom(needle, hay, start);
    if (attempt !== null && (best === null || attempt.score > best.score)) best = attempt;
  }
  return best;
}

function subsequenceFrom(
  needle: string,
  hay: string,
  start: number,
): { score: number; matched: number[] } | null {
  const matched: number[] = [];
  let score = 0;
  let from = start;

  for (const char of needle) {
    const nearest = hay.indexOf(char, from);
    if (nearest === -1) return null;

    let at = nearest;
    if (!isWordStart(hay, nearest)) {
      const previous = matched[matched.length - 1];
      const inRun = previous !== undefined && nearest === previous + 1;
      if (!inRun) {
        for (let cursor = hay.indexOf(char, nearest + 1); cursor !== -1;) {
          if (isWordStart(hay, cursor)) {
            at = cursor;
            break;
          }
          cursor = hay.indexOf(char, cursor + 1);
        }
      }
    }

    if (isWordStart(hay, at)) score += WORD_START;
    const previous = matched[matched.length - 1];
    if (previous !== undefined) {
      if (at === previous + 1) score += CONSECUTIVE;
      else score -= Math.min(GAP_PENALTY * (at - previous - 1), WORD_START);
    }
    matched.push(at);
    from = at + 1;
  }

  if (hay.startsWith(needle)) score += TITLE_PREFIX;
  return { score, matched };
}

/**
 * Rank commands for a query.
 *
 * An empty query returns every command in its declared order, so the palette
 * opens onto a menu rather than onto nothing. Ties keep declared order — the
 * sort is stable — which makes the result steady across renders.
 */
export function rankCommands(query: string, commands: readonly Command[]): RankedCommand[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return commands.map((command) => ({ command, score: 0, matched: [] }));
  }

  const ranked: RankedCommand[] = [];
  for (const command of commands) {
    const byTitle = subsequence(trimmed, command.title);
    const byKeyword = (command.keywords ?? []).some((keyword) =>
      keyword.toLowerCase().startsWith(trimmed.toLowerCase()),
    );

    if (byTitle === null && !byKeyword) continue;

    const score = (byTitle?.score ?? 0) + (byKeyword ? KEYWORD_HIT : 0);
    ranked.push({ command, score, matched: byTitle?.matched ?? [] });
  }

  return ranked.sort((a, b) => b.score - a.score);
}
