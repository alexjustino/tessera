import { describe, expect, it } from 'vitest';

import { rankCommands, type Command } from './palette';

const COMMANDS: Command[] = [
  { id: 'go.today', title: 'Go to Today', group: 'navigate', keywords: ['home'] },
  { id: 'go.tasks', title: 'Go to Tasks', group: 'navigate' },
  { id: 'go.board', title: 'Go to Board', group: 'navigate', keywords: ['kanban'] },
  { id: 'go.calendar', title: 'Go to Calendar', group: 'navigate', keywords: ['agenda'] },
  { id: 'new.task', title: 'New task', group: 'create', shortcut: 'Ctrl+N' },
  { id: 'reminders.pause', title: 'Pause reminders for an hour', group: 'reminders' },
  { id: 'theme.dark', title: 'Use dark theme', group: 'appearance' },
];

const ids = (query: string) => rankCommands(query, COMMANDS).map((r) => r.command.id);

describe('rankCommands', () => {
  it('returns every command in declared order for an empty query', () => {
    expect(ids('')).toEqual(COMMANDS.map((c) => c.id));
    expect(ids('   ')).toEqual(COMMANDS.map((c) => c.id));
  });

  it('puts the obvious answer first for a short prefix', () => {
    expect(ids('tod')[0]).toBe('go.today');
    expect(ids('tas')[0]).toBe('go.tasks');
    expect(ids('boa')[0]).toBe('go.board');
    expect(ids('new')[0]).toBe('new.task');
  });

  it('matches initials across words', () => {
    expect(ids('gb')[0]).toBe('go.board');
    expect(ids('gc')[0]).toBe('go.calendar');
  });

  it('ignores whitespace and case in the query', () => {
    expect(ids('go bo')[0]).toBe('go.board');
    expect(ids('GO BO')[0]).toBe('go.board');
  });

  it('finds a command by a keyword that is not in its title', () => {
    expect(ids('kanban')).toEqual(['go.board']);
    expect(ids('agenda')).toEqual(['go.calendar']);
    expect(ids('home')).toContain('go.today');
  });

  it('excludes commands whose letters are not all there in order', () => {
    expect(ids('xyz')).toEqual([]);
    expect(ids('tasks board')).toEqual([]);
  });

  it('reports the matched indices for highlighting', () => {
    const [top] = rankCommands('board', COMMANDS);
    expect(top?.command.id).toBe('go.board');
    expect(top?.matched).toEqual([6, 7, 8, 9, 10]);
  });

  it('keeps declared order between equal scores', () => {
    expect(ids('go to').slice(0, 4)).toEqual(['go.today', 'go.tasks', 'go.board', 'go.calendar']);
  });

  it('does not mutate the input', () => {
    const before = COMMANDS.map((c) => c.id);
    rankCommands('t', COMMANDS);
    expect(COMMANDS.map((c) => c.id)).toEqual(before);
  });
});
