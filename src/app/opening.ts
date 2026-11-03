/**
 * The opening: the mark, set tile by tile, while the workspace is being read.
 *
 * It is drawn by `index.html`, before any of this code has loaded, because that
 * is the moment it exists for. All this does is take it away once there is
 * something to show. It never holds the window longer than its own short
 * animation, and it never takes a press: the window underneath is already live.
 */

/** Long enough for the tiles to land, so it reads as an arrival and not a flicker. */
const SHOWN_AT_LEAST_MS = 1100;

/** The fade out. Matches the transition in `index.html`. */
const FADE_MS = 300;

/** How long the opening should stay, given how long it has been up. */
export function remainingMs(elapsedMs: number, shownAtLeastMs = SHOWN_AT_LEAST_MS): number {
  return Math.max(0, shownAtLeastMs - elapsedMs);
}

/** Take the opening away. Safe to call more than once, or when it is already gone. */
export function closeOpening(): void {
  const element = document.getElementById('opening');
  if (element === null || element.dataset.leaving === 'true') return;
  element.dataset.leaving = 'true';
  window.setTimeout(() => {
    element.classList.add('opening-leaving');
    window.setTimeout(() => element.remove(), FADE_MS);
  }, remainingMs(performance.now()));
}
