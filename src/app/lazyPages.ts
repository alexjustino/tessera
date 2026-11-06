import { lazy } from 'react';

/**
 * The screens a window does not need in order to open.
 *
 * Everything used to be one 1.4 MB script, parsed before the first paint on every
 * start, including a code highlighter for a notes page nobody had opened. Each of
 * these is now its own file, fetched from the application's own bundle, and
 * `preloadPages` reads them all once the window has settled, so the first visit to
 * a screen does not wait either.
 */
const load = {
  mosaic: () => import('@/features/mosaic/MosaicPage'),
  notes: () => import('@/features/notes/NotesPage'),
  goals: () => import('@/features/goals/GoalsPage'),
  review: () => import('@/features/review/ReviewPage'),
  reports: () => import('@/features/reports/ReportsPage'),
  settings: () => import('@/features/settings/SettingsPage'),
  diagnostics: () => import('@/features/foundation/FoundationPage'),
  about: () => import('@/features/about/AboutPage'),
  focus: () => import('@/features/focus/FocusMode'),
  calendar: () => import('@/features/calendar/CalendarView'),
  board: () => import('@/features/views/BoardView'),
  timeline: () => import('@/features/views/TimelineView'),
  table: () => import('@/features/views/TableView'),
  editor: () => import('@/features/editor/Editor'),
};

export const MosaicPage = lazy(() =>
  load.mosaic().then((module) => ({ default: module.MosaicPage })),
);
export const NotesPage = lazy(() => load.notes().then((module) => ({ default: module.NotesPage })));
export const GoalsPage = lazy(() => load.goals().then((module) => ({ default: module.GoalsPage })));
export const ReviewPage = lazy(() =>
  load.review().then((module) => ({ default: module.ReviewPage })),
);
export const ReportsPage = lazy(() =>
  load.reports().then((module) => ({ default: module.ReportsPage })),
);
export const SettingsPage = lazy(() =>
  load.settings().then((module) => ({ default: module.SettingsPage })),
);
export const FoundationPage = lazy(() =>
  load.diagnostics().then((module) => ({ default: module.FoundationPage })),
);
export const AboutPage = lazy(() => load.about().then((module) => ({ default: module.AboutPage })));
export const FocusMode = lazy(() => load.focus().then((module) => ({ default: module.FocusMode })));
export const CalendarView = lazy(() =>
  load.calendar().then((module) => ({ default: module.CalendarView })),
);
export const BoardView = lazy(() => load.board().then((module) => ({ default: module.BoardView })));
export const TimelineView = lazy(() =>
  load.timeline().then((module) => ({ default: module.TimelineView })),
);
export const TableView = lazy(() => load.table().then((module) => ({ default: module.TableView })));
export const Editor = lazy(() => load.editor().then((module) => ({ default: module.Editor })));

/** Read every screen in the background, one at a time, when the window is idle. */
export function preloadPages(): void {
  const queue = Object.values(load);
  const next = () => {
    const step = queue.shift();
    if (step === undefined) return;
    // A screen that fails here fails again when it is opened, where it can be said.
    void step()
      .catch(() => undefined)
      .then(() => window.setTimeout(next, 0));
  };
  window.setTimeout(next, 0);
}
