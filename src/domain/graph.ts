/**
 * What must come first: the dependency graph over tasks.
 *
 * One edge, one meaning — `blockerId` must be finished before `blockedId` can
 * start. Everything 1.1 adds reads this graph: the timeline draws its arrows
 * from it, the critical path is its longest chain, and capacity is what is left
 * once the chain is laid on a calendar. So the graph is decided here, once, in
 * a module that never touches a database or a screen (ADR-003).
 *
 * The rule that shapes the rest: **the graph is acyclic, always**. A cycle is
 * not a strange state to render carefully — it is work that can never start, and
 * the honest thing is to refuse the edge that would close it and say which
 * chain it closed.
 */

/** `blocker` must finish before `blocked` may start. */
export interface Edge {
  blockerId: string;
  blockedId: string;
}

/** Adjacency, blocker → the things it blocks. Built once per question. */
function forward(edges: readonly Edge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.blockerId);
    if (list === undefined) map.set(edge.blockerId, [edge.blockedId]);
    else list.push(edge.blockedId);
  }
  return map;
}

/** The tasks that must finish before this one may start. */
export function blockersOf(edges: readonly Edge[], id: string): string[] {
  return edges.filter((edge) => edge.blockedId === id).map((edge) => edge.blockerId);
}

/** The tasks waiting on this one. */
export function blockedBy(edges: readonly Edge[], id: string): string[] {
  return edges.filter((edge) => edge.blockerId === id).map((edge) => edge.blockedId);
}

/**
 * Everything reachable from `from` by following the arrows, `from` excluded.
 *
 * Breadth-first with a seen set, so a diamond — two paths to the same task —
 * is visited once rather than twice, and a graph that already holds a cycle
 * (which storage refuses, but a corrupted file could carry) terminates instead
 * of hanging the screen.
 */
export function reachableFrom(edges: readonly Edge[], from: string): Set<string> {
  const next = forward(edges);
  const seen = new Set<string>();
  const queue = [...(next.get(from) ?? [])];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const onward of next.get(id) ?? []) {
      if (!seen.has(onward)) queue.push(onward);
    }
  }
  return seen;
}

/**
 * The chain that adding `blocker → blocked` would close, or null when it would
 * not close one.
 *
 * Returned as a path rather than a boolean because "that would make a loop" is
 * not a useful thing to tell somebody. The path is what lets the interface say
 * *which* loop: `Ship it → Test it → Fix it → Ship it`.
 */
export function cycleFrom(
  edges: readonly Edge[],
  blockerId: string,
  blockedId: string,
): string[] | null {
  // A task cannot block itself.
  if (blockerId === blockedId) return [blockerId, blockedId];

  // The new edge closes a cycle exactly when the blocker is already reachable
  // from the blocked task — that is, when the blocked task already has to
  // finish first, by some route.
  const next = forward(edges);
  const path = new Map<string, string | null>([[blockedId, null]]);
  const queue = [blockedId];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (id === blockerId) {
      // Walk the parents back to the start, then close the loop.
      const chain: string[] = [];
      let step: string | null | undefined = id;
      while (typeof step === 'string') {
        chain.unshift(step);
        step = path.get(step);
      }
      return [...chain, blockedId];
    }
    for (const onward of next.get(id) ?? []) {
      if (!path.has(onward)) {
        path.set(onward, id);
        queue.push(onward);
      }
    }
  }
  return null;
}

/** Whether adding this edge would close a cycle. */
export function wouldCycle(edges: readonly Edge[], blockerId: string, blockedId: string): boolean {
  return cycleFrom(edges, blockerId, blockedId) !== null;
}

/** `Ship it → Test it → Fix it → Ship it`, from a chain of ids and their titles. */
export function describeCycle(chain: readonly string[], titleOf: (id: string) => string): string {
  return chain.map((id) => titleOf(id) || 'Untitled').join(' → ');
}

/** Whether a task is waiting on something that has not been finished. */
export function isBlocked(
  edges: readonly Edge[],
  id: string,
  isComplete: (id: string) => boolean,
): boolean {
  return blockersOf(edges, id).some((blocker) => !isComplete(blocker));
}

/**
 * The tasks nothing is holding up: incomplete, and with every blocker finished.
 *
 * This is what "what can I actually start" means once work has an order, and it
 * is the query the focus mode and the daily plan will both ask.
 */
export function readyToStart(
  ids: readonly string[],
  edges: readonly Edge[],
  isComplete: (id: string) => boolean,
): string[] {
  return ids.filter((id) => !isComplete(id) && !isBlocked(edges, id, isComplete));
}

/**
 * Every task in an order where each comes after everything blocking it.
 *
 * Kahn's algorithm, with ties broken by the order the ids arrived — so the
 * result is stable, and a list that was sorted by position stays as close to
 * that as the dependencies allow. Ids caught in a cycle come last, in their
 * original order, rather than vanishing: a view must draw what is there.
 */
export function topologicalOrder(ids: readonly string[], edges: readonly Edge[]): string[] {
  const present = new Set(ids);
  const relevant = edges.filter(
    (edge) => present.has(edge.blockerId) && present.has(edge.blockedId),
  );

  const remaining = new Map<string, number>();
  for (const id of ids) remaining.set(id, 0);
  for (const edge of relevant) {
    remaining.set(edge.blockedId, (remaining.get(edge.blockedId) ?? 0) + 1);
  }

  const next = forward(relevant);
  const ready = ids.filter((id) => remaining.get(id) === 0);
  const ordered: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift() as string;
    ordered.push(id);
    for (const onward of next.get(id) ?? []) {
      const left = (remaining.get(onward) ?? 0) - 1;
      remaining.set(onward, left);
      // Insert where the original order says, so ties stay stable.
      if (left === 0) {
        const at = ready.findIndex((candidate) => ids.indexOf(candidate) > ids.indexOf(onward));
        if (at === -1) ready.push(onward);
        else ready.splice(at, 0, onward);
      }
    }
  }

  // Whatever a cycle swallowed, in the order it came.
  const placed = new Set(ordered);
  return [...ordered, ...ids.filter((id) => !placed.has(id))];
}
