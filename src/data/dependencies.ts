/**
 * The typed client for the dependency graph.
 */

import { invoke } from '@tauri-apps/api/core';

import type { Edge } from '@/domain/graph';

interface RawDependency {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

/** Every edge in the workspace, as the domain layer wants them. */
export async function listDependencies(): Promise<Edge[]> {
  const raw = await invoke<RawDependency[]>('dependencies_list');
  return raw.map((row) => ({ blockerId: row.blocker_id, blockedId: row.blocked_id }));
}

export async function linkDependency(blockerId: string, blockedId: string): Promise<void> {
  await invoke<void>('dependency_link', { blockerId, blockedId });
}

export async function unlinkDependency(blockerId: string, blockedId: string): Promise<void> {
  await invoke<void>('dependency_unlink', { blockerId, blockedId });
}
