# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Theme and density moved from Diagnostics to Settings, and are now remembered.
- The Windows accent colour is applied when the window opens, not only after
  visiting Diagnostics.
- Deleting an item now removes its document and its search-index rows. They key
  on owner rather than a foreign key, so nothing cascaded on its own and the
  database leaked a row per paragraph.
- `item.status_id` is gone. Status is a property like any other; the column was
  speculative and was never written to.

### Added

- **Settings.** Theme, density, the quick-capture shortcut (a closed list of
  four combinations), daily backups and how many to keep, start with Windows —
  kept in the workspace file, applied when the window opens.
- **Backups.** A compacted copy of the workspace on the first start of each
  day and on request, kept in rotation beside the file. Restore from the list
  or from any file; a backup of the current state is taken first, so a restore
  can itself be undone.
- **Export and import.** JSON is the whole workspace, every table and column,
  and the only form that imports — import replaces, never merges, inspects the
  file first and asks. Markdown for tasks and notes; iCalendar for events and
  dated tasks, with repeat rules and cancelled occurrences.
- **Quick capture.** `Ctrl+Alt+Space` in any program opens a one-line window over
  whatever is on screen. Plain words become the task's date, time, repeat rule,
  priority and reminder — "Pay rent on friday at 9am !high remind me 15m
  before" — and every phrase is shown as a chip before Enter, so what was
  understood is visible and can be undone. The same grammar works in the add
  line on Tasks. Also reachable from the tray menu and the palette.
- **Command palette.** `Ctrl+K`, or the Search field at the top of the rail:
  every command the product has, ranked by the letters typed, and one search
  over tasks and events through the full-text index — prefix matching,
  accent-insensitive, matched words highlighted. Enter opens the hit.
- **Events are searchable** alongside tasks, from the same box (ADR-008).
- Diagnostics says whether the quick-capture shortcut registered, and why not
  when another program owns it.
- **An end-to-end suite** (`npm run e2e`) that drives the real binary — Rust
  host, WebView2 page, SQLite file — through WebDriver, on a workspace it
  relocates so it never touches a real one (ADR-016).
- **The mark.** Tessera's own icon — four tiles, one being set — on the
  taskbar, the tray, the installer, the title bar and About. The template's
  placeholder is gone.
- **Windows reminders**: a native toast at the time you asked for, with
  Complete, Snooze and Open on it. Closing the window keeps them coming — the
  tray keeps the process alive, and Quit in the tray menu is what ends it.
- A tray icon with Open, Today, Pause for an hour, Resume and Quit; its tooltip
  says how many things are due today.
- "Start with Windows", off by default, from Diagnostics.
- Reminders that came due while Tessera was closed fire on the next start —
  grouped into one toast when there are several.
- **Calendar**: day, work week, week, month and agenda over the same items and
  events, with a now line, working-hours shading, an all-day lane and events
  that can be dragged to another time.
- **Time blocking**: drag a task from the side panel onto the grid and it
  becomes reserved time while staying the same task.
- **Dates and recurrence**: due and start dates with a time, repetition by RRULE
  in two modes — on the calendar, or counted from when you actually finish it.
  Ticking a repeating task advances it instead of closing it.
- **Today, Overdue and Next 7 days**: saved queries that belong to no collection
  and hold relative dates, so they mean today on the day you open them.
- **Block editor**: every item is a document. Headings, lists, to-dos, quotes,
  callouts, code with syntax highlighting, tables, images, links and dividers,
  by markdown shorthand or the `/` menu. Saved incrementally — an edited
  paragraph writes one row.
- **Kanban board**: columns from any select, status or priority property, drag
  between and within them by pointer _or keyboard_, work-in-progress limits,
  collapsible columns, and a choice of which properties appear on a card.
  Dropping a card writes its position and its field in one transaction.
- **Views**: a saved query — filters, sorting, grouping — shown as a list or a
  table, switchable from a tab strip and saved on demand. Sorting headers on the
  table; a third click clears the sort.
- **Query engine** in the domain layer, measured at fifty thousand items: a
  filter runs in 20 ms against a 50 ms target (see ADR-004 for the full table).
- `TabStrip` design system primitive.
- **Typed properties**: eleven types (text, number, checkbox, link, select,
  multi-select, status, priority, date, date and time, duration), edited inline
  on a row or in a detail panel, with the same editor in both places.
- Property management: declare, rename and remove properties, and edit the
  options of a select.
- `Select`, `Chip` and `Drawer` design system primitives.
- **Tasks**: create, complete, rename, reorder and delete, stored in SQLite and
  still there after a restart. The first feature that crosses every layer.
- Item repository with transactional writes that keep the full-text index in step.
- `Input`, `Checkbox` and `EmptyState` design system primitives.
- Project foundation: Tauri 2 + React + TypeScript + Vite + Tailwind skeleton.
- Apache-2.0 licence, NOTICE with trademark statement, contributor documentation.
- Fluent design token layer, Mica window material, system accent colour, custom title bar.
- SQLite persistence with forward-only migrations (`001_init`).
- Windows toast notification path with action buttons, proven from an installed build.
- Validation gates (`npm run gates`) and CI running the same script.
- Full specification, data model, architecture decisions and design system contract.

[Unreleased]: https://github.com/alexjustino/tessera/compare/main...HEAD
