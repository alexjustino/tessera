import {
  Board20Regular,
  Calendar20Regular,
  Home20Regular,
  Settings20Regular,
  TaskListSquareLtr20Regular,
  Wrench20Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';

/**
 * The navigation rail.
 *
 * Destinations the foundation slice has not built yet are shown disabled rather
 * than hidden: a person can see the shape of the product and where the work is
 * going, and nothing pretends to work when it does not.
 */

export type Destination = 'tasks' | 'foundation';

interface Entry {
  id: string;
  label: string;
  icon: ReactNode;
  ready: boolean;
}

const ENTRIES: Entry[] = [
  { id: 'today', label: 'Today', icon: <Home20Regular />, ready: false },
  { id: 'tasks', label: 'Tasks', icon: <TaskListSquareLtr20Regular />, ready: true },
  { id: 'board', label: 'Board', icon: <Board20Regular />, ready: false },
  { id: 'calendar', label: 'Calendar', icon: <Calendar20Regular />, ready: false },
  { id: 'settings', label: 'Settings', icon: <Settings20Regular />, ready: false },
  { id: 'foundation', label: 'Foundation', icon: <Wrench20Regular />, ready: true },
];

export function Sidebar({
  active,
  onNavigate,
}: {
  active: Destination;
  onNavigate: (destination: Destination) => void;
}) {
  return (
    <nav
      aria-label="Main"
      className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-stroke-subtle bg-layer-alt p-2"
    >
      {ENTRIES.map((entry) => {
        const selected = entry.ready && entry.id === active;
        return (
          <button
            key={entry.id}
            type="button"
            disabled={!entry.ready}
            aria-current={selected ? 'page' : undefined}
            onClick={() => entry.ready && onNavigate(entry.id as Destination)}
            title={entry.ready ? entry.label : `${entry.label} — not built yet`}
            className={[
              'flex h-(--density-row) items-center gap-3 rounded-md px-3 text-body',
              'transition-colors duration-100 ease-easy',
              selected ? 'bg-accent-subtle font-semibold text-fg' : 'text-fg-secondary',
              entry.ready ? 'hover:bg-card-hover' : 'cursor-not-allowed text-fg-disabled',
            ].join(' ')}
          >
            <span aria-hidden="true" className={selected ? 'text-accent' : undefined}>
              {entry.icon}
            </span>
            <span className="truncate">{entry.label}</span>
            {!entry.ready && <span className="ml-auto text-caption text-fg-disabled">soon</span>}
          </button>
        );
      })}
    </nav>
  );
}
