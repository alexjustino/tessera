import { useState } from 'react';

import { AboutPage } from '@/features/about/AboutPage';
import { FoundationPage } from '@/features/foundation/FoundationPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { Sidebar, type Destination } from '@/features/shell/Sidebar';
import { TitleBar } from '@/features/shell/TitleBar';

/**
 * The window shell: title bar, navigation rail, content layer.
 *
 * The outer element is transparent so the Mica material Windows paints behind
 * the window shows through the chrome; the content region is the "layer" that
 * floats on it. That separation is the whole reason the application reads as
 * native rather than as a web page in a frame.
 */
export function App() {
  const [destination, setDestination] = useState<Destination>('tasks');

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar active={destination} onNavigate={setDestination} />
        <main className="min-w-0 flex-1 overflow-y-auto bg-layer">
          {/* Today is the same page opened on a different saved view — it is
              a query over the same items, not a second screen. */}
          {destination === 'tasks' && <TasksPage key="tasks" />}
          {destination === 'today' && <TasksPage key="today" initialViewId="view.today" />}
          {destination === 'board' && <TasksPage key="board" initialViewId="tasks.board" />}
          {destination === 'calendar' && <TasksPage key="calendar" initialViewId="view.calendar" />}
          {destination === 'diagnostics' && <FoundationPage />}
          {destination === 'about' && <AboutPage />}
        </main>
      </div>
    </div>
  );
}
