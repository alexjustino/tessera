/**
 * The import door: what every importer produces, what the person sees before
 * anything is written, and what is finally handed to the host.
 *
 * An importer — Tessera's own export today; Todoist, Trello, Notion and ICS in
 * the slices after this one — reads a file and produces an `ImportPlan`: rows
 * that do not exist yet, named by the collection they should land in and by
 * the properties they carry, with no ids. The plan is then **previewed**
 * against what the workspace already holds, so a person can see what would be
 * created and what looks like something they already have, and decide.
 *
 * Nothing here writes. The host applies a plan in one transaction and records
 * what it created, so the whole import can be undone as one thing (ADR-026).
 */

import type { CalendarEvent } from './calendar';
import type { Collection, Item } from './item';
import type { PropertyType } from './property';
import { localDay } from './schedule';

// ── The plan ───────────────────────────────────────────────────────────────

export interface ImportedCollection {
  name: string;
  icon: string | null;
  color: string | null;
}

/** A block for the task's document, as the editor's own node JSON. */
export interface ImportedBlock {
  /** The node type: `paragraph`, `heading`, `taskList`… */
  type: string;
  content: unknown;
}

/** One choice a select, multi-select or status property should offer. */
export interface SelectOptionPlan {
  id: string;
  label: string;
  color: string | null;
  group?: 'todo' | 'doing' | 'done';
}

/**
 * A property the plan needs on its collection. Created if absent; if present
 * with the same type, the options it does not have yet are added — and undo
 * puts them back the way they were.
 *
 * `options` belongs to the types that offer choices and is absent for the
 * rest: a number column has no options, and an empty list would say it had
 * none rather than that the question does not arise.
 */
export interface ImportedProperty {
  collection: string;
  name: string;
  type: PropertyType;
  options?: SelectOptionPlan[];
}

export interface ImportedTask {
  /** Local to the plan; what the preview refers to. */
  key: string;
  /** The collection this lands in, by name. Created if it does not exist. */
  collection: string;
  title: string;
  /** Plain text notes; the host writes them as one paragraph. */
  notes: string | null;
  startAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  estimateMinutes: number | null;
  isMilestone: boolean;
  /** Property values by property *name*, as the source called them. */
  values: Record<string, unknown>;
  /** Blocks for the task's document, in order. Written after `notes`. */
  blocks?: ImportedBlock[];
}

/**
 * One occurrence of a series that does not follow the rule: called off, or
 * moved to another time.
 *
 * It belongs to the event rather than sitting beside it, because it is only
 * meaningful against that event's rule — and because it needs the id the host
 * gives the event on the way in, which the plan does not have. The door's
 * deferral about links between imported rows stands; this is not one.
 */
export interface ImportedException {
  /** The instant the rule would have produced, which is what it matches on. */
  originalStart: string;
  kind: 'cancelled' | 'moved';
  /** Where it went, for a moved occurrence; null for a cancelled one. */
  startsAt: string | null;
  endsAt: string | null;
}

export interface ImportedEvent {
  key: string;
  title: string;
  startsAt: string;
  endsAt: string;
  tz: string;
  allDay: boolean;
  rrule: string | null;
  /** Occurrences of this series that were moved or called off. */
  exceptions?: ImportedException[];
}

export interface ImportPlan {
  /** Where it came from — shown in the preview and kept with the batch. */
  source: string;
  collections: ImportedCollection[];
  tasks: ImportedTask[];
  events: ImportedEvent[];
  /** What the importer could not carry, in sentences. Never silent. */
  warnings: string[];
  /** Properties the tasks' values need, created or extended before the tasks. */
  properties?: ImportedProperty[];
}

export const EMPTY_PLAN: ImportPlan = {
  source: '',
  collections: [],
  tasks: [],
  events: [],
  warnings: [],
};

// ── The preview ────────────────────────────────────────────────────────────

/** What the workspace holds now, as far as duplicates are concerned. */
export interface Existing {
  collections: readonly Collection[];
  items: readonly Item[];
  events: readonly CalendarEvent[];
}

export interface CollectionPreview {
  name: string;
  action: 'create' | 'reuse';
}

export interface TaskPreview {
  key: string;
  title: string;
  collection: string;
  /** The existing task this looks like, or null. */
  duplicateOf: string | null;
}

export interface EventPreview {
  key: string;
  title: string;
  duplicateOf: string | null;
}

export interface Preview {
  source: string;
  collections: CollectionPreview[];
  tasks: TaskPreview[];
  events: EventPreview[];
  counts: {
    collectionsToCreate: number;
    tasks: number;
    events: number;
    duplicates: number;
  };
  warnings: string[];
}

/** `  Renew   the Passport ` and `renew the passport` are the same title. */
export function normalise(text: string): string {
  return text.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

/**
 * What an import would do to this workspace.
 *
 * A duplicate is a guess, and the preview says so by naming what it matched:
 * a task with the same title in the same collection on the same due day (or
 * both undated); an event with the same title at the same instant. The person
 * decides whether to skip them; the product does not merge (SPEC: 1.2 does not
 * guess at merges).
 */
export function preview(plan: ImportPlan, existing: Existing, zone: string): Preview {
  const collectionByName = new Map(
    existing.collections.map((collection) => [normalise(collection.name), collection]),
  );

  const collections: CollectionPreview[] = plan.collections.map((collection) => ({
    name: collection.name,
    action: collectionByName.has(normalise(collection.name)) ? 'reuse' : 'create',
  }));

  // Tasks are matched inside their target collection, by title and due day.
  const itemIndex = new Map<string, Item>();
  for (const item of existing.items) {
    if (item.completedAt !== null && item.dueAt === null) continue; // done and undated: noise
    itemIndex.set(taskFingerprint(item.collectionId, item.title, item.dueAt, zone), item);
  }
  const collectionIdByName = (name: string) => collectionByName.get(normalise(name))?.id ?? null;

  const tasks: TaskPreview[] = plan.tasks.map((task) => {
    const collectionId = collectionIdByName(task.collection);
    const match =
      collectionId === null
        ? undefined
        : itemIndex.get(taskFingerprint(collectionId, task.title, task.dueAt, zone));
    return {
      key: task.key,
      title: task.title,
      collection: task.collection,
      duplicateOf: match?.id ?? null,
    };
  });

  const eventIndex = new Map(
    existing.events.map((event) => [eventFingerprint(event.title, event.startsAt), event]),
  );
  const events: EventPreview[] = plan.events.map((event) => ({
    key: event.key,
    title: event.title,
    duplicateOf: eventIndex.get(eventFingerprint(event.title, event.startsAt))?.id ?? null,
  }));

  return {
    source: plan.source,
    collections,
    tasks,
    events,
    counts: {
      collectionsToCreate: collections.filter((entry) => entry.action === 'create').length,
      tasks: tasks.length,
      events: events.length,
      duplicates:
        tasks.filter((entry) => entry.duplicateOf !== null).length +
        events.filter((entry) => entry.duplicateOf !== null).length,
    },
    warnings: plan.warnings,
  };
}

function taskFingerprint(
  collectionId: string,
  title: string,
  dueAt: string | null,
  zone: string,
): string {
  return `${collectionId}|${normalise(title)}|${dueAt === null ? '' : localDay(dueAt, zone)}`;
}

function eventFingerprint(title: string, startsAt: string): string {
  return `${normalise(title)}|${startsAt}`;
}

/** The plan with the duplicates left out, when the person asked for that. */
export function decide(plan: ImportPlan, shown: Preview, skipDuplicates: boolean): ImportPlan {
  if (!skipDuplicates) return plan;
  const skipTasks = new Set(
    shown.tasks.filter((entry) => entry.duplicateOf !== null).map((entry) => entry.key),
  );
  const skipEvents = new Set(
    shown.events.filter((entry) => entry.duplicateOf !== null).map((entry) => entry.key),
  );
  return {
    ...plan,
    tasks: plan.tasks.filter((task) => !skipTasks.has(task.key)),
    events: plan.events.filter((event) => !skipEvents.has(event.key)),
  };
}

/**
 * The same plan, every task bound for one collection instead.
 *
 * A Todoist project or a To Do list arrives named, and the honest default is
 * to keep the name. But the list a person looks at shows one collection today,
 * so the preview offers to put the rows where they will be seen; this is that
 * choice applied. Events are untouched — they belong to the calendar.
 */
export function redirect(plan: ImportPlan, collection: string): ImportPlan {
  const name = collection.trim();
  if (name === '') return plan;
  return {
    ...plan,
    collections: [{ name, icon: null, color: null }],
    tasks: plan.tasks.map((task) => ({ ...task, collection: name })),
    ...(plan.properties === undefined
      ? {}
      : { properties: plan.properties.map((property) => ({ ...property, collection: name })) }),
  };
}

/**
 * A property the workspace already has, as far as reconciling cares.
 */
export interface ExistingProperty {
  name: string;
  type: PropertyType;
  options: readonly SelectOptionPlan[];
}

/** Types that store one chosen option, and can stand in for one another. */
const ONE_CHOICE: ReadonlySet<PropertyType> = new Set(['select', 'status', 'priority']);

/**
 * The plan, against the properties the collection already has.
 *
 * An importer names its columns as the other product named them, and a name
 * can already be taken here by a property of another type — a Notion database
 * with a "Status" column arriving beside this product's own Status. Three
 * answers, in order of how good they are for the person:
 *
 * 1. **Same type**: nothing to do. The host adds the options it lacks.
 * 2. **Both choose one option** (select, status, priority): the import adopts
 *    the property that is here, and its values are remapped onto the options
 *    already there by label — so "In progress" from Notion lands in the column
 *    called In progress rather than beside it. Options with no match are added.
 * 3. **A real clash** (a number column called Estimate where Estimate is text):
 *    the import keeps its own column under a distinct name and says so. Nothing
 *    is coerced, because coercing is guessing and the value would be the thing
 *    lost.
 */
export function reconcile(plan: ImportPlan, existing: readonly ExistingProperty[]): ImportPlan {
  if (plan.properties === undefined || plan.properties.length === 0) return plan;
  const byName = new Map(existing.map((property) => [normalise(property.name), property]));

  const renamed = new Map<string, string>();
  const remapped = new Map<string, Map<string, string>>();
  const warnings = [...plan.warnings];

  const properties = plan.properties.map((property) => {
    const here = byName.get(normalise(property.name));
    if (here === undefined || here.type === property.type) return property;

    if (ONE_CHOICE.has(here.type) && ONE_CHOICE.has(property.type)) {
      // Adopt what is here, and speak its option ids where the labels agree.
      const idByLabel = new Map(here.options.map((option) => [normalise(option.label), option.id]));
      const map = new Map<string, string>();
      const kept: SelectOptionPlan[] = [];
      for (const option of property.options ?? []) {
        const match = idByLabel.get(normalise(option.label));
        if (match === undefined) kept.push(option);
        else map.set(option.id, match);
      }
      if (map.size > 0) remapped.set(property.name, map);
      return { ...property, type: here.type, options: kept };
    }

    const name = `${property.name} (imported)`;
    renamed.set(property.name, name);
    warnings.push(
      `“${property.name}” is already a ${here.type.replace('_', '-')} property here and the file’s is a ${property.type.replace('_', '-')}; the file’s was imported as “${name}”.`,
    );
    return { ...property, name };
  });

  if (renamed.size === 0 && remapped.size === 0) {
    return { ...plan, properties, warnings };
  }

  const tasks = plan.tasks.map((task) => {
    const values: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(task.values)) {
      const map = remapped.get(name);
      const moved =
        map === undefined
          ? value
          : typeof value === 'string'
            ? (map.get(value) ?? value)
            : Array.isArray(value)
              ? value.map((entry) =>
                  typeof entry === 'string' ? (map.get(entry) ?? entry) : entry,
                )
              : value;
      values[renamed.get(name) ?? name] = moved;
    }
    return { ...task, values };
  });

  return { ...plan, properties, tasks, warnings };
}

/** `3 tasks, 1 event and a new collection, from Tessera export` */
export function describe(shown: Preview): string {
  const parts: string[] = [];
  if (shown.counts.tasks > 0)
    parts.push(`${shown.counts.tasks} ${shown.counts.tasks === 1 ? 'task' : 'tasks'}`);
  if (shown.counts.events > 0)
    parts.push(`${shown.counts.events} ${shown.counts.events === 1 ? 'event' : 'events'}`);
  if (shown.counts.collectionsToCreate > 0) {
    parts.push(
      shown.counts.collectionsToCreate === 1
        ? 'a new collection'
        : `${shown.counts.collectionsToCreate} new collections`,
    );
  }
  if (parts.length === 0) return 'Nothing to import.';
  const list =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${list}, from ${shown.source}.`;
}

// ── The first importer through the door: Tessera's own export ─────────────

/**
 * Another workspace's export, as a plan — additive, where the 1.0 import was
 * a replacement. Reads the export's own tables (collections, items, values,
 * blocks, events), keeps what it can name, and says what it dropped.
 */
export function fromTesseraExport(raw: unknown): ImportPlan | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const document = raw as { format?: unknown; tables?: unknown };
  if (document.format !== 'tessera-export') return null;
  if (typeof document.tables !== 'object' || document.tables === null) return null;
  const tables = document.tables as Record<string, unknown>;
  const rows = (name: string): Record<string, unknown>[] => {
    const table = tables[name];
    return Array.isArray(table)
      ? table.filter(
          (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
        )
      : [];
  };

  const warnings: string[] = [];

  const collectionsById = new Map<string, ImportedCollection>();
  for (const row of rows('collection')) {
    if (row.archived_at) continue;
    if (typeof row.id !== 'string' || typeof row.name !== 'string') continue;
    collectionsById.set(row.id, {
      name: row.name,
      icon: typeof row.icon === 'string' ? row.icon : null,
      color: typeof row.color === 'string' ? row.color : null,
    });
  }

  const propertyNames = new Map<string, string>();
  for (const row of rows('property')) {
    if (typeof row.id === 'string' && typeof row.name === 'string') {
      propertyNames.set(row.id, row.name);
    }
  }

  const valuesByItem = new Map<string, Record<string, unknown>>();
  let unnamedValues = 0;
  for (const row of rows('item_property_value')) {
    if (typeof row.item_id !== 'string' || typeof row.property_id !== 'string') continue;
    const name = propertyNames.get(row.property_id);
    if (name === undefined) {
      unnamedValues += 1;
      continue;
    }
    let value: unknown = row.value_json;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        // A value that is not JSON is kept as the text it is.
      }
    }
    valuesByItem.set(row.item_id, { ...(valuesByItem.get(row.item_id) ?? {}), [name]: value });
  }
  if (unnamedValues > 0) {
    warnings.push(
      `${unnamedValues} property ${unnamedValues === 1 ? 'value' : 'values'} named a property the file does not describe, and ${unnamedValues === 1 ? 'was' : 'were'} left out.`,
    );
  }

  const notesByOwner = new Map<string, string[]>();
  for (const row of rows('block')) {
    if (row.owner_kind !== 'item' || typeof row.owner_id !== 'string') continue;
    const text = blockText(row.content_json);
    if (text.trim() === '') continue;
    notesByOwner.set(row.owner_id, [...(notesByOwner.get(row.owner_id) ?? []), text]);
  }

  const tasks: ImportedTask[] = [];
  let orphaned = 0;
  let archived = 0;
  for (const row of rows('item')) {
    if (row.archived_at) {
      archived += 1;
      continue;
    }
    if (typeof row.id !== 'string' || typeof row.title !== 'string') continue;
    const collection =
      typeof row.collection_id === 'string' ? collectionsById.get(row.collection_id) : undefined;
    if (collection === undefined) {
      orphaned += 1;
      continue;
    }
    tasks.push({
      key: `task:${row.id}`,
      collection: collection.name,
      title: row.title,
      notes: notesByOwner.has(row.id) ? notesByOwner.get(row.id)!.join('\n\n') : null,
      startAt: optionalString(row.start_at),
      dueAt: optionalString(row.due_at),
      completedAt: optionalString(row.completed_at),
      estimateMinutes: typeof row.estimate_minutes === 'number' ? row.estimate_minutes : null,
      isMilestone: row.is_milestone === 1 || row.is_milestone === true,
      values: valuesByItem.get(row.id) ?? {},
    });
  }
  if (orphaned > 0) {
    warnings.push(
      `${orphaned} ${orphaned === 1 ? 'task belongs' : 'tasks belong'} to a collection the file does not describe, and ${orphaned === 1 ? 'was' : 'were'} left out.`,
    );
  }
  if (archived > 0) {
    warnings.push(`${archived} archived ${archived === 1 ? 'task was' : 'tasks were'} left out.`);
  }

  const events: ImportedEvent[] = [];
  for (const row of rows('event')) {
    if (
      typeof row.id !== 'string' ||
      typeof row.title !== 'string' ||
      typeof row.starts_at_utc !== 'string' ||
      typeof row.ends_at_utc !== 'string'
    ) {
      continue;
    }
    events.push({
      key: `event:${row.id}`,
      title: row.title,
      startsAt: row.starts_at_utc,
      endsAt: row.ends_at_utc,
      tz: typeof row.tz === 'string' ? row.tz : 'UTC',
      allDay: row.all_day === 1 || row.all_day === true,
      rrule: optionalString(row.rrule),
    });
  }
  const exceptions = rows('event_exception').length;
  if (exceptions > 0) {
    warnings.push(
      `${exceptions} ${exceptions === 1 ? 'exception' : 'exceptions'} to repeating events ${exceptions === 1 ? 'was' : 'were'} left out; the series import whole.`,
    );
  }
  const blocked = rows('time_block').length;
  if (blocked > 0) {
    warnings.push(
      `${blocked} time ${blocked === 1 ? 'block imports' : 'blocks import'} as plain events, no longer tied to a task.`,
    );
  }
  const links = rows('item_dependency').length;
  if (links > 0) {
    warnings.push(
      `${links} ${links === 1 ? 'dependency was' : 'dependencies were'} left out; the door carries rows, not the links between them yet.`,
    );
  }

  return {
    source: 'a Tessera export',
    collections: [...collectionsById.values()],
    tasks,
    events,
    warnings,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The text inside a block's content, whatever its shape, joined by spaces. */
export function blockText(contentJson: unknown): string {
  let content: unknown = contentJson;
  if (typeof contentJson === 'string') {
    try {
      content = JSON.parse(contentJson);
    } catch {
      return contentJson;
    }
  }
  const pieces: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.text === 'string') pieces.push(record.text);
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'text') walk(value);
    }
  };
  walk(content);
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}
