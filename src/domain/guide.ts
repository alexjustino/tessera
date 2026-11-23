/**
 * The User Guide: what Tessera does and how, written once (ADR-064).
 *
 * The Guide screen reads these chapters, and `docs/USER_GUIDE.md` is generated from
 * them by `guideMarkdown`, so the guide in the product and the one in the repository
 * cannot say different things: a test compares the file with what this module writes.
 *
 * Pure: no React, no host. A scene is named here and drawn by the Guide screen; a
 * place is where "Try it" takes the person.
 */

/** The animated pictures the Guide screen can draw, one per idea. */
export type SceneId =
  | 'capture'
  | 'complete'
  | 'ritual'
  | 'replan'
  | 'board'
  | 'calendar'
  | 'mosaic'
  | 'notes'
  | 'palette'
  | 'data';

/** Where "Try it" goes. The same names the sidebar uses. */
export type GuidePlace =
  | 'today'
  | 'tasks'
  | 'board'
  | 'calendar'
  | 'mosaic'
  | 'notes'
  | 'goals'
  | 'review'
  | 'reports'
  | 'settings';

export interface GuideKey {
  keys: string;
  does: string;
}

export interface GuideSection {
  id: string;
  title: string;
  /** Paragraphs, in order. */
  body: readonly string[];
  /** A short list after the paragraphs, when the idea is a set of things. */
  points?: readonly string[];
  /** Keys and what they do, when the section is about the keyboard. */
  keys?: readonly GuideKey[];
  scene?: SceneId;
  tryIt?: { label: string; place: GuidePlace };
}

export interface GuideChapter {
  id: string;
  title: string;
  /** One line under the title, and the chapter's line in the contents. */
  summary: string;
  sections: readonly GuideSection[];
}

export const GUIDE: readonly GuideChapter[] = [
  {
    id: 'start',
    title: 'Getting started',
    summary: 'What Tessera is, and the four things it keeps together.',
    sections: [
      {
        id: 'what',
        title: 'One place for the work, the notes and the time',
        body: [
          'Tessera keeps your tasks, your notes and your calendar in one workspace on your own computer. A task can have a date, a time on the calendar, steps and a page of notes; a meeting can have its notes; and the week shows what all of it adds up to.',
          'Everything lives in one file under your Windows profile. There is no account and nothing to sign in to. The only request Tessera makes to the internet is a daily check for a newer release, which you can turn off in Settings.',
        ],
        scene: 'complete',
        tryIt: { label: 'Open Today', place: 'today' },
      },
      {
        id: 'places',
        title: 'Where things are',
        body: ['The sidebar on the left holds every place. The ones you will use most:'],
        points: [
          'Today: what is due, what was left from before, and the day’s plan.',
          'Tasks and Board: your lists, as rows or as columns.',
          'Calendar: events, and the time you reserve for tasks.',
          'Mosaic: the week drawn as tiles of time.',
          'Notes: pages in coloured sections, like a notebook.',
          'Goals, Review and Reports: where the week is measured and looked back on.',
        ],
      },
    ],
  },
  {
    id: 'capture',
    title: 'Capturing tasks',
    summary: 'Write a task the way you would say it, from anywhere in Windows.',
    sections: [
      {
        id: 'quick',
        title: 'Quick capture',
        body: [
          'Press Ctrl+Alt+Space in any program and a capture line opens over it. Type the task and press Enter: it is saved and the line goes away, without leaving what you were doing. The shortcut can be changed in Settings.',
          'Tessera reads dates, times, repeats, priorities, reminders and lists out of the line, and shows each as a chip before the task is made, so you see what it understood. Remove a chip and its words go back into the title.',
        ],
        points: [
          'Dates: today, tomorrow, tonight, monday, next week, in 3 days, 5 sep.',
          'Times: at 5pm, 17:30, at noon.',
          'Repeats: every day, every weekday, every monday, every 2 weeks, monthly.',
          'Priority: !urgent, !high, !medium, !low (or !1 to !4).',
          'Reminders: remind me, remind me 15m before, remind 1d before.',
          'Lists: #work puts the task in the list called Work, when there is one.',
        ],
        scene: 'capture',
        tryIt: { label: 'Open Tasks', place: 'tasks' },
      },
      {
        id: 'steps',
        title: 'Steps, estimates and notes',
        body: [
          'Open a task to give it steps: small things to tick on the way, which never count as tasks of their own. Give it an estimate, and the calendar and the day’s weight use it. Pair it with a page in Notes when it needs more than a line.',
        ],
        tryIt: { label: 'Open Tasks', place: 'tasks' },
      },
      {
        id: 'done',
        title: 'Finishing a task',
        body: [
          'Tick the circle beside a task and it is done: it leaves the list and counts towards today. A repeating task makes its next occurrence when the last one is ticked. A task finished by mistake is still there: turn on Show completed items in the list’s filters, and untick it.',
        ],
        scene: 'complete',
      },
    ],
  },
  {
    id: 'day',
    title: 'The day',
    summary: 'Plan the morning in a minute, and close the evening in another.',
    sections: [
      {
        id: 'ritual',
        title: 'Plan my day, and close it',
        body: [
          'Today starts with Your day. Plan my day walks three steps: what was due before today goes to today, to tomorrow or to done; today’s work is weighed against its free time, and you are told when it is more than the day has; and the suggested plan’s blocks for today go on the calendar in one press.',
          'Close the day walks three more: what got done, with the clock and the day’s score; what is not finished, moved to tomorrow at the same time of day; and a line about the day, kept in a Journal page in Notes, one page a month. Each closed day keeps its score, so the days before can be read back.',
        ],
        scene: 'ritual',
        tryIt: { label: 'Open Today', place: 'today' },
      },
      {
        id: 'replan',
        title: 'Late work, replanned in one press',
        body: [
          'When tasks are late, Today offers to replan them: each is moved to the next free working time, shown to you before anything changes, and written in one go. One press undoes all of it.',
        ],
        scene: 'replan',
        tryIt: { label: 'Open Today', place: 'today' },
      },
      {
        id: 'now',
        title: 'What to do now',
        body: [
          'Now, on Today, is one answer: the task the day most needs next, computed from what is due, what is late and what is already on the calendar. Start it, and its clock runs; Focus mode hides everything else.',
        ],
      },
    ],
  },
  {
    id: 'lists',
    title: 'Lists and the Board',
    summary: 'Keep work apart by list, and move it across columns.',
    sections: [
      {
        id: 'lists',
        title: 'Lists',
        body: [
          'Tasks is the inbox. Make a list for each area of your life or each project, give it a colour, and the colour follows its tasks everywhere. Every count in Tessera reads all of your lists, so nothing hides because it lives in another one.',
        ],
        tryIt: { label: 'Open Tasks', place: 'tasks' },
      },
      {
        id: 'board',
        title: 'The Board',
        body: [
          'The Board shows a list as columns, one per status. Drag a card to another column, or use the keyboard: the first column holds the cards with no status yet, and is where a card goes to clear one.',
        ],
        scene: 'board',
        tryIt: { label: 'Open the Board', place: 'board' },
      },
    ],
  },
  {
    id: 'time',
    title: 'Calendar and time',
    summary: 'Give work a place in the week, and see where the hours went.',
    sections: [
      {
        id: 'calendar',
        title: 'The calendar',
        body: [
          'The calendar holds events and the blocks of time you reserve for tasks. Drag a task from the side panel onto the grid to reserve time for it, drag a block to move it, and pull its edge to change its length. With a block selected, Shift and the arrow keys move it in steps.',
          'Tessera also suggests a plan: the work that is due, placed in your free working hours. Suggestions are drawn dashed and are never written until you reserve them.',
        ],
        scene: 'calendar',
        tryIt: { label: 'Open the Calendar', place: 'calendar' },
      },
      {
        id: 'hours',
        title: 'Working hours and days off',
        body: [
          'Your working hours and days off are what Tessera counts as free time. Set them once in Settings → Working time, and every plan, every day’s weight and every suggestion follows them.',
        ],
        tryIt: { label: 'Open Settings', place: 'settings' },
      },
      {
        id: 'clock',
        title: 'The clock',
        body: [
          'Start the clock on a task and Tessera keeps the time. It is what Reports, Mosaic and the day’s close add up, and it keeps running if the window is closed to the tray.',
        ],
      },
    ],
  },
  {
    id: 'week',
    title: 'Mosaic and goals',
    summary: 'The week as tiles of time, and what you want it to hold.',
    sections: [
      {
        id: 'mosaic',
        title: 'The Mosaic',
        body: [
          'Mosaic draws the week as tiles, one tile for each stretch of time, coloured by list. A glance says where the hours went and how much of the week is still free. Envelopes set aside time for an area of life, and fill as the tiles land in them.',
        ],
        scene: 'mosaic',
        tryIt: { label: 'Open Mosaic', place: 'mosaic' },
      },
      {
        id: 'goals',
        title: 'Goals',
        body: [
          'A goal is time you want to give something each week, or a finish line. You decide what counts towards it, and its progress is read from the clock, never typed in.',
        ],
        tryIt: { label: 'Open Goals', place: 'goals' },
      },
    ],
  },
  {
    id: 'notes',
    title: 'Notes',
    summary: 'A notebook in sections and pages, joined to your tasks and meetings.',
    sections: [
      {
        id: 'pages',
        title: 'Sections and pages',
        body: [
          'Notes is kept like a notebook: coloured sections on the left, pages inside them. Quick notes holds the pages filed nowhere. Type / on an empty line for headings, lists, tables, code and images; select text to format it or to highlight it in colour.',
        ],
        scene: 'notes',
        tryIt: { label: 'Open Notes', place: 'notes' },
      },
      {
        id: 'markers',
        title: 'To do, Follow up and markers',
        body: [
          'Mark a line as To do and tick it where it stands. Mark it Follow up and it becomes a task with a date, done when the task is. Markers such as Important or Question give a line a meaning you can find again.',
        ],
      },
      {
        id: 'meetings',
        title: 'Meeting notes',
        body: [
          'Open a meeting on the calendar and press Meeting notes: Tessera makes a page for that occurrence, with its time and title, and keeps the two together. A task can be paired with a page the same way.',
        ],
        tryIt: { label: 'Open the Calendar', place: 'calendar' },
      },
      {
        id: 'email',
        title: 'Sending a page as an email',
        body: [
          'Press Draft an email from this, the envelope in a page’s toolbar, and the page, or the part of it you selected, becomes a formatted draft in your own mail program. Tessera writes the draft and hands it to Windows; it never sends anything itself.',
        ],
      },
    ],
  },
  {
    id: 'looking-back',
    title: 'Reports and review',
    summary: 'See the week and the month, and close the week on purpose.',
    sections: [
      {
        id: 'reports',
        title: 'Reports',
        body: [
          'Reports adds up a week or a month: the time tracked, the tasks finished, the time reserved and the work that ran over its estimate, by task and by day. Every figure can be opened to show the rows it came from.',
        ],
        tryIt: { label: 'Open Reports', place: 'reports' },
      },
      {
        id: 'review',
        title: 'The weekly review',
        body: [
          'Review shows what is missing, the things no other screen can show because they are absences: a goal nothing can be done for, a task still waiting for something already finished, and work that is due with no time set aside for it. It keeps nothing of its own, and it is finished when there is nothing left to show.',
        ],
        tryIt: { label: 'Open Review', place: 'review' },
      },
    ],
  },
  {
    id: 'keys',
    title: 'Keyboard',
    summary: 'Every place and action, without leaving the keyboard.',
    sections: [
      {
        id: 'palette',
        title: 'The command palette',
        body: [
          'Press Ctrl+K anywhere in the window and type to find a task, an event or a page by name. Start with > for commands: every place in Tessera and every action, by name. It is the fastest way around.',
        ],
        scene: 'palette',
      },
      {
        id: 'shortcuts',
        title: 'Shortcuts',
        body: ['The keys that work throughout Tessera:'],
        keys: [
          { keys: 'Ctrl+Alt+Space', does: 'Quick capture, from any program (can be changed)' },
          { keys: 'Ctrl+K', does: 'The command palette' },
          { keys: 'F1', does: 'This guide' },
          { keys: '/', does: 'On an empty line in Notes, the list of blocks' },
          { keys: 'Shift+↑ / Shift+↓', does: 'Move the selected calendar block' },
          { keys: 'Enter', does: 'Open what is selected, or save what is typed' },
          { keys: 'Esc', does: 'Close a menu, a dialog or quick capture' },
        ],
      },
    ],
  },
  {
    id: 'data',
    title: 'Your data',
    summary: 'Where it lives, how it is kept safe, and how it comes and goes.',
    sections: [
      {
        id: 'local',
        title: 'Local, and yours',
        body: [
          'Your workspace is one file under your Windows profile. The first time Tessera opens each day it backs that file up, and keeps the last seven copies unless you choose another number. Settings → Backups lists them and restores one.',
        ],
        scene: 'data',
        tryIt: { label: 'Open Settings', place: 'settings' },
      },
      {
        id: 'moving',
        title: 'Export and import',
        body: [
          'Export everything to JSON, Markdown or a calendar file at any time. Bring work in from Microsoft To Do (its Outlook tasks file), Todoist, Notion, Trello or a calendar file, in Settings → Add from another product: the import shows what it will add first, and one press undoes it.',
        ],
        tryIt: { label: 'Open Settings', place: 'settings' },
      },
      {
        id: 'updates',
        title: 'Updates',
        body: [
          'Once a day Tessera asks GitHub whether a newer release exists, and tells you when one does. Nothing is installed until you press Install and restart, and every update is checked against Tessera’s own key first. Settings → Updates turns the check off.',
        ],
        tryIt: { label: 'Open Settings', place: 'settings' },
      },
    ],
  },
];

/** Lower case, without accents or punctuation that a person would not type. */
function normalise(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '');
}

function sectionText(section: GuideSection): string {
  return [
    section.title,
    ...section.body,
    ...(section.points ?? []),
    ...(section.keys ?? []).flatMap((key) => [key.keys, key.does]),
  ].join(' ');
}

export interface GuideHit {
  chapter: GuideChapter;
  section: GuideSection;
}

/**
 * The sections that hold every word of `query`, in the guide's own order. A blank
 * query finds nothing: the screen shows the contents instead.
 */
export function searchGuide(query: string, guide: readonly GuideChapter[] = GUIDE): GuideHit[] {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: GuideHit[] = [];
  for (const chapter of guide) {
    for (const section of chapter.sections) {
      const text = normalise(`${chapter.title} ${sectionText(section)}`);
      if (words.every((word) => text.includes(word))) hits.push({ chapter, section });
    }
  }
  return hits;
}

/** The chapter that holds a section, by the section's id within it. */
export function findSection(
  chapterId: string,
  sectionId: string,
  guide: readonly GuideChapter[] = GUIDE,
): GuideHit | null {
  const chapter = guide.find((one) => one.id === chapterId);
  const section = chapter?.sections.find((one) => one.id === sectionId);
  return chapter && section ? { chapter, section } : null;
}

/** A Markdown table with its columns lined up, the way the formatter writes one. */
function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = head.map((title, column) =>
    Math.max(3, title.length, ...rows.map((row) => row[column]!.length)),
  );
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column]!)).join(' | ')} |`;
  return [
    line(head),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ];
}

/** `docs/USER_GUIDE.md`, written from the same chapters the screen shows. */
export function guideMarkdown(guide: readonly GuideChapter[] = GUIDE): string {
  const lines: string[] = [
    '# Tessera User Guide',
    '',
    '<!-- Generated from src/domain/guide.ts by `npm run guide:doc`. Edit the chapters there, not this file. -->',
    '',
    'The same guide is inside Tessera: press **F1**, or choose **Guide** in the sidebar.',
    '',
    '## Contents',
    '',
    ...guide.map(
      (chapter, index) => `${index + 1}. [${chapter.title}](#${chapter.id}) — ${chapter.summary}`,
    ),
  ];
  guide.forEach((chapter, index) => {
    lines.push(
      '',
      `## ${index + 1}. ${chapter.title} {#${chapter.id}}`,
      '',
      `_${chapter.summary}_`,
    );
    for (const section of chapter.sections) {
      lines.push('', `### ${section.title}`);
      for (const paragraph of section.body) lines.push('', paragraph);
      if (section.points) lines.push('', ...section.points.map((point) => `- ${point}`));
      if (section.keys)
        lines.push(
          '',
          ...table(
            ['Keys', 'Does'],
            section.keys.map((k) => [k.keys, k.does]),
          ),
        );
    }
  });
  return `${lines.join('\n')}\n`;
}
