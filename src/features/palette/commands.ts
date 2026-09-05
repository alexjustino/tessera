/**
 * What the palette can do. Data, not components: the list is ranked by the
 * domain layer and rendered by the palette; what each entry *does* is decided
 * by the shell, which owns navigation.
 */

import type { Command } from '@/domain/palette';
import type { Destination } from '@/features/shell/Sidebar';

export type CommandId =
  | `go.${Destination}`
  | 'new.task'
  | 'focus.start'
  | 'capture.open'
  | 'reminders.pause'
  | 'reminders.resume'
  | 'theme.system'
  | 'theme.light'
  | 'theme.dark';

export interface PaletteCommand extends Command {
  id: CommandId;
}

export const COMMANDS: readonly PaletteCommand[] = [
  { id: 'go.today', title: 'Go to Today', group: 'navigate', keywords: ['home', 'due'] },
  { id: 'go.tasks', title: 'Go to Tasks', group: 'navigate', keywords: ['list', 'table'] },
  { id: 'go.board', title: 'Go to Board', group: 'navigate', keywords: ['kanban', 'columns'] },
  { id: 'go.calendar', title: 'Go to Calendar', group: 'navigate', keywords: ['agenda', 'week'] },
  {
    id: 'go.settings',
    title: 'Go to Settings',
    group: 'navigate',
    keywords: ['preferences', 'backup', 'export', 'theme'],
  },
  { id: 'go.diagnostics', title: 'Go to Diagnostics', group: 'navigate', keywords: ['probe'] },
  { id: 'go.about', title: 'Go to About', group: 'navigate', keywords: ['version', 'licence'] },
  {
    id: 'go.reports',
    title: 'Go to Reports',
    group: 'navigate',
    keywords: ['tracked', 'week', 'month', 'estimate'],
  },
  {
    id: 'focus.start',
    title: 'Focus on one task',
    group: 'navigate',
    keywords: ['timer', 'zen', 'concentrate', 'next'],
  },
  { id: 'new.task', title: 'New task', group: 'create', keywords: ['add', 'create'] },
  {
    id: 'capture.open',
    title: 'Open quick capture',
    group: 'create',
    keywords: ['hotkey', 'shortcut'],
  },
  {
    id: 'reminders.pause',
    title: 'Pause reminders for an hour',
    group: 'reminders',
    keywords: ['mute', 'quiet', 'snooze'],
  },
  { id: 'reminders.resume', title: 'Resume reminders', group: 'reminders', keywords: ['unmute'] },
  { id: 'theme.system', title: 'Use the Windows theme', group: 'appearance', keywords: ['auto'] },
  { id: 'theme.light', title: 'Use light theme', group: 'appearance' },
  { id: 'theme.dark', title: 'Use dark theme', group: 'appearance' },
];
