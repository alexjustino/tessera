import { describe, expect, it } from 'vitest';

import { asWallClock } from '../schedule';

import { fromOutlookTasks, looksLikeOutlookTasks, readOutlookDate } from './outlookTasks';

const ZONE = 'America/Sao_Paulo';
const NOW = '2026-09-05T15:00:00.000Z';

const wall = (instant: string | null) => {
  const local = asWallClock(instant!, ZONE);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`;
};

const FILE = `"Subject","Start Date","Due Date","Reminder On/Off","Reminder Date","Reminder Time","Date Completed","Complete","Total Work","Actual Work","Billing Information","Categories","Companies","Contacts","Mileage","Notes","Priority","Private","Role","Schedule+ Priority","Sensitivity","Status","% Complete"
"Call the dentist","9/8/2026","9/10/2026","True","9/10/2026","9:00:00 AM","","False","30 minutes","0 hours","","","","","","Ask about the crown.","High","False","","","Normal","Not Started","0"
"Pay the electricity bill","","9/12/2026","False","","","","False","0 hours","0 hours","","Home","","","","","Normal","False","","","Normal","In Progress","50"
"Send the tax forms","","8/30/2026","False","","","9/1/2026","True","2 hours","2 hours","","","","","","","Low","False","","","Normal","Completed","100"
"Wait for the plumber","","","False","","","","False","0 hours","0 hours","","","","","","","Normal","False","","","Normal","Waiting on someone else","0"
`;

describe('recognising an Outlook task export', () => {
  it('knows the task-folder header, and nothing else', () => {
    expect(looksLikeOutlookTasks(FILE)).toBe(true);
    expect(looksLikeOutlookTasks('TYPE,CONTENT,PRIORITY,INDENT\ntask,x,1,1\n')).toBe(false);
  });
});

describe('a To Do list exported from Outlook', () => {
  const plan = fromOutlookTasks(FILE, 'Home', ZONE, NOW)!;
  const byTitle = new Map(plan.tasks.map((task) => [task.title, task]));

  it('lands in a collection named after the list, one task per row', () => {
    expect(plan.collections).toEqual([{ name: 'Home', icon: null, color: null }]);
    expect(plan.tasks).toHaveLength(4);
    expect(plan.source).toBe('a Microsoft To Do list (Home), exported from Outlook');
  });

  it('reads month/day/year dates as the end of that day in the machine’s zone', () => {
    expect(wall(byTitle.get('Call the dentist')!.dueAt)).toBe('2026-09-10 23:59');
    expect(wall(byTitle.get('Call the dentist')!.startAt)).toBe('2026-09-08 23:59');
    expect(byTitle.get('Wait for the plumber')!.dueAt).toBeNull();
  });

  it('keeps completion with its date, and marks the status done', () => {
    const sent = byTitle.get('Send the tax forms')!;
    expect(wall(sent.completedAt)).toBe('2026-09-01 23:59');
    expect(sent.values).toEqual({ Priority: 'low', Status: 'done' });
  });

  it('maps High and Low, and leaves Normal — Outlook’s default — unset', () => {
    expect(byTitle.get('Call the dentist')!.values.Priority).toBe('high');
    expect(byTitle.get('Pay the electricity bill')!.values.Priority).toBeUndefined();
  });

  it('maps the status onto the seeded options', () => {
    expect(byTitle.get('Call the dentist')!.values.Status).toBe('todo');
    expect(byTitle.get('Pay the electricity bill')!.values.Status).toBe('doing');
    expect(byTitle.get('Wait for the plumber')!.values.Status).toBe('blocked');
  });

  it('keeps notes and total work', () => {
    expect(byTitle.get('Call the dentist')!.notes).toBe('Ask about the crown.');
    expect(byTitle.get('Call the dentist')!.estimateMinutes).toBe(30);
    expect(byTitle.get('Send the tax forms')!.estimateMinutes).toBe(120);
    expect(byTitle.get('Pay the electricity bill')!.estimateMinutes).toBeNull();
  });

  it('says what it left out', () => {
    expect(plan.warnings).toEqual([
      '1 task had a reminder in Outlook; set them again here if you still want them.',
      '1 task had categories; they were left out.',
    ]);
  });

  it('a completed task with no completion date is completed as of the import', () => {
    const plan2 = fromOutlookTasks(
      'Subject,Due Date,Complete,Status\nDone thing,,True,Completed\n',
      'x',
      ZONE,
      NOW,
    )!;
    expect(plan2.tasks[0]!.completedAt).toBe(NOW);
  });

  it('refuses what has no Subject column', () => {
    expect(fromOutlookTasks('TYPE,CONTENT\ntask,x\n', 'x', ZONE, NOW)).toBeNull();
    expect(fromOutlookTasks('', 'x', ZONE, NOW)).toBeNull();
  });
});

describe('reading an Outlook date', () => {
  it('reads month first, or day first when the day is over twelve or the date is dotted', () => {
    expect(wall(readOutlookDate('9/10/2026', '', ZONE))).toBe('2026-09-10 23:59');
    expect(wall(readOutlookDate('25/9/2026', '', ZONE))).toBe('2026-09-25 23:59');
    expect(wall(readOutlookDate('10.09.2026', '', ZONE))).toBe('2026-09-10 23:59');
    expect(wall(readOutlookDate('2026-09-10', '', ZONE))).toBe('2026-09-10 23:59');
  });

  it('reads a time beside it, twelve-hour or twenty-four', () => {
    expect(wall(readOutlookDate('9/10/2026', '9:00:00 AM', ZONE))).toBe('2026-09-10 09:00');
    expect(wall(readOutlookDate('9/10/2026', '12:30:00 PM', ZONE))).toBe('2026-09-10 12:30');
    expect(wall(readOutlookDate('9/10/2026', '12:05 AM', ZONE))).toBe('2026-09-10 00:05');
    expect(wall(readOutlookDate('9/10/2026', '18:45', ZONE))).toBe('2026-09-10 18:45');
  });

  it('refuses what is not a date', () => {
    expect(readOutlookDate('None', '', ZONE)).toBeNull();
    expect(readOutlookDate('13/13/2026', '', ZONE)).toBeNull();
    expect(readOutlookDate('2/30/2026', '', ZONE)).toBeNull();
    expect(readOutlookDate('', '', ZONE)).toBeNull();
  });
});
