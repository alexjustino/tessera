/**
 * The typed client for goals.
 */

import { invoke } from '@tauri-apps/api/core';

import type { Goal, GoalLink, Measure } from '@/domain/goal';

interface RawGoal {
  id: string;
  name: string;
  measure: string;
  target: number;
  due_day: string | null;
  position: string;
  created_at: string;
  updated_at: string;
}

interface RawLink {
  goal_id: string;
  item_id: string;
}

function toGoal(raw: RawGoal): Goal {
  return {
    id: raw.id,
    name: raw.name,
    // The host's check constraint allows only these two; anything else would
    // be a workspace written by another build, and counting tasks is the
    // reading that cannot show a wrong total.
    measure: raw.measure === 'minutes' ? 'minutes' : 'tasks',
    target: raw.target,
    dueDay: raw.due_day,
    position: raw.position,
  };
}

export async function listGoals(): Promise<Goal[]> {
  return (await invoke<RawGoal[]>('goals_list')).map(toGoal);
}

export async function createGoal(input: {
  name: string;
  measure: Measure;
  target: number;
  dueDay: string | null;
  position: string;
}): Promise<Goal> {
  return toGoal(
    await invoke<RawGoal>('goal_create', {
      name: input.name,
      measure: input.measure,
      target: input.target,
      dueDay: input.dueDay,
      position: input.position,
    }),
  );
}

/** Change what is named; what is left out stays as it was. */
export interface GoalPatch {
  name?: string;
  measure?: Measure;
  target?: number;
  dueDay?: string | null;
}

export async function updateGoal(id: string, patch: GoalPatch): Promise<Goal> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.measure !== undefined) body.measure = patch.measure;
  if (patch.target !== undefined) body.target = patch.target;
  // Sent only when the caller means it: absent leaves the day alone, null
  // clears it, and the host tells the two apart.
  if (patch.dueDay !== undefined) body.dueDay = patch.dueDay;
  return toGoal(await invoke<RawGoal>('goal_update', { id, patch: body }));
}

export async function deleteGoal(id: string): Promise<void> {
  await invoke<void>('goal_delete', { id });
}

export async function listGoalLinks(): Promise<GoalLink[]> {
  const raw = await invoke<RawLink[]>('goal_links_list');
  return raw.map((link) => ({ goalId: link.goal_id, itemId: link.item_id }));
}

export async function linkGoalItem(goalId: string, itemId: string): Promise<void> {
  await invoke<void>('goal_link', { goalId, itemId });
}

export async function unlinkGoalItem(goalId: string, itemId: string): Promise<void> {
  await invoke<void>('goal_unlink', { goalId, itemId });
}
