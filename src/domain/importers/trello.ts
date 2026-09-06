/**
 * Trello, from the JSON a board exports (Menu → More → Print and export →
 * Export as JSON).
 *
 * A board is a collection. Its lists are the columns of a board here, which
 * is to say options of the Status property: a list whose name matches an
 * option already there ("Done") reuses it, so cards land in the column the
 * person already has; any other list becomes a new option, grouped as to do,
 * doing or done by what its name says. Cards are tasks, in list order then
 * card order, with the description as a paragraph and each checklist as a
 * heading and a task list of checked and unchecked items — blocks the editor
 * already knows. Labels become a multi-select property, one option per label.
 *
 * Archived lists and cards, attachments, comments, members and custom fields
 * are not carried, and each is said in a sentence.
 */

import type {
  ImportPlan,
  ImportedBlock,
  ImportedProperty,
  ImportedTask,
  SelectOptionPlan,
} from '../importing';

interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
}
interface TrelloLabel {
  id: string;
  name: string;
  color: string | null;
}
interface TrelloCheckItem {
  name: string;
  state: string;
  pos: number;
}
interface TrelloChecklist {
  id: string;
  name: string;
  idCard: string;
  pos: number;
  checkItems: TrelloCheckItem[];
}
interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  closed: boolean;
  pos: number;
  due: string | null;
  start: string | null;
  dueComplete: boolean;
  idLabels: string[];
  idChecklists: string[];
  badges?: { attachments?: number; comments?: number };
  idMembers?: string[];
  customFieldItems?: unknown[];
}

/** Trello's label colours, as the token names the design system has. */
const LABEL_COLOURS: Record<string, string | null> = {
  green: 'success',
  yellow: 'caution',
  orange: 'caution',
  red: 'danger',
  purple: 'accent',
  blue: 'info',
  sky: 'info',
  lime: 'success',
  pink: 'danger',
  black: null,
};

export function looksLikeTrello(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const board = raw as Record<string, unknown>;
  return Array.isArray(board.lists) && Array.isArray(board.cards) && typeof board.name === 'string';
}

/**
 * The plan for a Trello board.
 *
 * `existingStatus` is the Status property's options as the workspace has
 * them, so a list called "Done" maps onto the option already called Done
 * rather than making a second column with the same name.
 */
export function fromTrello(
  raw: unknown,
  existingStatus: readonly SelectOptionPlan[],
): ImportPlan | null {
  if (!looksLikeTrello(raw)) return null;
  const board = raw as {
    name: string;
    lists: unknown[];
    cards: unknown[];
    labels?: unknown[];
    checklists?: unknown[];
  };
  const collection = board.name.trim() === '' ? 'Trello' : board.name.trim();
  const warnings: string[] = [];

  // Lists → status options, in board order.
  const allLists = board.lists.filter(isList);
  const closedLists = allLists.filter((list) => list.closed).length;
  const lists = allLists.filter((list) => !list.closed).sort((a, b) => a.pos - b.pos);
  const existingByLabel = new Map(
    existingStatus.map((option) => [normalise(option.label), option]),
  );
  const statusOptions: SelectOptionPlan[] = [];
  const optionIdByList = new Map<string, string>();
  for (const list of lists) {
    const match = existingByLabel.get(normalise(list.name));
    if (match !== undefined) {
      optionIdByList.set(list.id, match.id);
      continue;
    }
    const option: SelectOptionPlan = {
      id: `trello-${slug(list.name) || list.id}`,
      label: list.name.trim() || 'Untitled list',
      color: null,
      group: groupOf(list.name),
    };
    // Two lists with the same name are one column here.
    if (!statusOptions.some((candidate) => candidate.id === option.id)) statusOptions.push(option);
    optionIdByList.set(list.id, option.id);
  }

  // Labels → one multi-select property.
  const labels = (board.labels ?? []).filter(isLabel);
  const labelOptions: SelectOptionPlan[] = [];
  const optionIdByLabel = new Map<string, string>();
  for (const label of labels) {
    const name = label.name.trim() || (label.color ?? 'label');
    const option: SelectOptionPlan = {
      id: `trello-${slug(name) || label.id}`,
      label: name,
      color: label.color === null ? null : (LABEL_COLOURS[label.color] ?? null),
    };
    if (!labelOptions.some((candidate) => candidate.id === option.id)) labelOptions.push(option);
    optionIdByLabel.set(label.id, option.id);
  }

  const checklistsByCard = new Map<string, TrelloChecklist[]>();
  for (const checklist of (board.checklists ?? []).filter(isChecklist)) {
    checklistsByCard.set(checklist.idCard, [
      ...(checklistsByCard.get(checklist.idCard) ?? []),
      checklist,
    ]);
  }

  // Cards → tasks, in list order then card order.
  const listOrder = new Map(lists.map((list, index) => [list.id, index]));
  const allCards = board.cards.filter(isCard);
  const closedCards = allCards.filter((card) => card.closed).length;
  const orphanCards = allCards.filter((card) => !card.closed && !listOrder.has(card.idList)).length;
  const cards = allCards
    .filter((card) => !card.closed && listOrder.has(card.idList))
    .sort((a, b) => listOrder.get(a.idList)! - listOrder.get(b.idList)! || a.pos - b.pos);

  let attachments = 0;
  let comments = 0;
  let members = 0;
  let customFields = 0;
  const tasks: ImportedTask[] = cards.map((card) => {
    attachments += card.badges?.attachments ?? 0;
    comments += card.badges?.comments ?? 0;
    if ((card.idMembers ?? []).length > 0) members += 1;
    if ((card.customFieldItems ?? []).length > 0) customFields += 1;

    const values: Record<string, unknown> = { Status: optionIdByList.get(card.idList)! };
    const cardLabels = card.idLabels
      .map((id) => optionIdByLabel.get(id))
      .filter((id): id is string => id !== undefined);
    if (cardLabels.length > 0) values.Labels = cardLabels;

    const blocks: ImportedBlock[] = [];
    for (const checklist of (checklistsByCard.get(card.id) ?? []).sort((a, b) => a.pos - b.pos)) {
      blocks.push({
        type: 'heading',
        content: {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: checklist.name.trim() || 'Checklist' }],
        },
      });
      const items = [...checklist.checkItems].sort((a, b) => a.pos - b.pos);
      if (items.length > 0) {
        blocks.push({
          type: 'taskList',
          content: {
            type: 'taskList',
            content: items.map((item) => ({
              type: 'taskItem',
              attrs: { checked: item.state === 'complete' },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: item.name }] }],
            })),
          },
        });
      }
    }

    return {
      key: `trello:${card.id}`,
      collection,
      title: card.name.trim() || 'Untitled card',
      notes: card.desc.trim() === '' ? null : card.desc.trim(),
      startAt: instant(card.start),
      dueAt: instant(card.due),
      completedAt: card.dueComplete && card.due !== null ? instant(card.due) : null,
      estimateMinutes: null,
      isMilestone: false,
      values,
      blocks,
    };
  });

  const properties: ImportedProperty[] = [];
  if (statusOptions.length > 0) {
    properties.push({ collection, name: 'Status', type: 'status', options: statusOptions });
  }
  if (labelOptions.length > 0) {
    properties.push({ collection, name: 'Labels', type: 'multi_select', options: labelOptions });
  }

  const say = (count: number, one: string, many: string) =>
    count > 0 && warnings.push(`${count} ${count === 1 ? one : many}.`);
  say(closedLists, 'archived list was left out', 'archived lists were left out');
  say(closedCards, 'archived card was left out', 'archived cards were left out');
  say(
    orphanCards,
    'card belongs to a list the file does not describe, and was left out',
    'cards belong to lists the file does not describe, and were left out',
  );
  say(attachments, 'attachment was left out', 'attachments were left out');
  say(comments, 'comment was left out', 'comments were left out');
  say(
    members,
    'card had members; there is one person here',
    'cards had members; there is one person here',
  );
  say(
    customFields,
    'card had custom fields, which were left out',
    'cards had custom fields, which were left out',
  );

  return {
    source: `a Trello board (${collection})`,
    collections: [{ name: collection, icon: null, color: null }],
    tasks,
    events: [],
    warnings,
    properties,
  };
}

function isList(value: unknown): value is TrelloList {
  const list = value as Partial<TrelloList> | null;
  return (
    typeof list === 'object' &&
    list !== null &&
    typeof list.id === 'string' &&
    typeof list.name === 'string'
  );
}
function isLabel(value: unknown): value is TrelloLabel {
  const label = value as Partial<TrelloLabel> | null;
  return (
    typeof label === 'object' &&
    label !== null &&
    typeof label.id === 'string' &&
    typeof label.name === 'string'
  );
}
function isChecklist(value: unknown): value is TrelloChecklist {
  const list = value as Partial<TrelloChecklist> | null;
  return (
    typeof list === 'object' &&
    list !== null &&
    typeof list.idCard === 'string' &&
    typeof list.name === 'string' &&
    Array.isArray(list.checkItems)
  );
}
function isCard(value: unknown): value is TrelloCard {
  const card = value as Partial<TrelloCard> | null;
  if (typeof card !== 'object' || card === null) return false;
  if (
    typeof card.id !== 'string' ||
    typeof card.name !== 'string' ||
    typeof card.idList !== 'string'
  )
    return false;
  const shaped = card as TrelloCard;
  shaped.desc = typeof card.desc === 'string' ? card.desc : '';
  shaped.closed = card.closed === true;
  shaped.pos = typeof card.pos === 'number' ? card.pos : 0;
  shaped.due = typeof card.due === 'string' ? card.due : null;
  shaped.start = typeof card.start === 'string' ? card.start : null;
  shaped.dueComplete = card.dueComplete === true;
  shaped.idLabels = Array.isArray(card.idLabels)
    ? card.idLabels.filter((id): id is string => typeof id === 'string')
    : [];
  shaped.idChecklists = Array.isArray(card.idChecklists) ? card.idChecklists : [];
  return true;
}

function instant(text: string | null): string | null {
  if (text === null) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** `In Progress` → `in-progress`: a stable id from a name. */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Which end of a workflow a list is, by what it is called. */
export function groupOf(name: string): 'todo' | 'doing' | 'done' {
  const lower = normalise(name);
  if (/\b(done|complete|completed|finished|shipped|released|closed)\b/.test(lower)) return 'done';
  if (/\b(doing|progress|working|review|testing|active|current)\b/.test(lower)) return 'doing';
  return 'todo';
}
