/**
 * The typed client for templates.
 *
 * The host stores the body as JSON it does not read; this is where it is
 * parsed and checked, so a template that reaches a component is a template.
 */

import { invoke } from '@tauri-apps/api/core';

import type { Item } from '@/domain/item';
import { readBody, type Template, type TemplateBody, type TemplateEdge } from '@/domain/template';

import { toItem, type RawItem } from './items';

interface RawTemplate {
  id: string;
  name: string;
  body_json: string;
  created_at: string;
  updated_at: string;
}

function toTemplate(raw: RawTemplate): Template | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.body_json);
  } catch {
    return null;
  }
  const body = readBody(parsed);
  return body === null ? null : { id: raw.id, name: raw.name, body, createdAt: raw.created_at };
}

/** Every template that reads as one. A row that does not is left out, not shown broken. */
export async function listTemplates(): Promise<Template[]> {
  const raw = await invoke<RawTemplate[]>('templates_list');
  return raw.map(toTemplate).filter((template): template is Template => template !== null);
}

export async function createTemplate(name: string, body: TemplateBody): Promise<Template> {
  const raw = await invoke<RawTemplate>('template_create', {
    name,
    bodyJson: JSON.stringify(body),
  });
  const template = toTemplate(raw);
  if (template === null) throw new Error('The template was saved but could not be read back.');
  return template;
}

export async function deleteTemplate(id: string): Promise<void> {
  await invoke<void>('template_delete', { id });
}

export interface PlannedTaskRequest {
  key: string;
  title: string;
  position: string;
  startAt: string | null;
  dueAt: string | null;
  estimateMinutes: number | null;
  isMilestone: boolean;
}

/** Every task and every link, or none. Returns the tasks as created. */
export async function applyTemplate(
  collectionId: string,
  tasks: PlannedTaskRequest[],
  edges: TemplateEdge[],
): Promise<Item[]> {
  const raw = await invoke<RawItem[]>('template_apply', {
    collectionId,
    tasks: tasks.map((task) => ({
      key: task.key,
      title: task.title,
      position: task.position,
      start_at: task.startAt,
      due_at: task.dueAt,
      estimate_minutes: task.estimateMinutes,
      is_milestone: task.isMilestone,
    })),
    edges: edges.map((edge) => ({ blocker_key: edge.blockerKey, blocked_key: edge.blockedKey })),
  });
  return raw.map(toItem);
}
