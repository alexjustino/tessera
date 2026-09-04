# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.0.0] — 2026-09-03

The first release. Tessera is a local-first workspace for tasks, projects and
time: one typed data core, many views over it, a block document inside every
item, a real calendar beside it, and native Windows reminders on top. It runs
entirely on your machine — no account, no cloud, no telemetry, no network.

This being the first release, everything below is new. What changed along the
way is in the commit history, where it belongs.

### The workspace

- **Tasks with typed properties.** Status, priority, select, multi-select,
  text, number, date and checkbox. Values round-trip; an option removed from a
  property does not silently rewrite the rows that used it.
- **Four views over the same items** — List, Table, Board and Calendar — each
  a saved query with its own filters, sort, grouping and columns. Today,
  Overdue and Next 7 days belong to no collection and hold relative dates, so
  they mean today on the day you open them.
- **A Kanban board** with drag by pointer or by keyboard, work-in-progress
  limits, collapsible columns and grouping by any property. Order survives a
  restart.
- **A block editor inside every item**: headings, lists, task lists, quotes,
  callouts, tables, code with syntax highlighting, images and links, with a
  slash menu. Saves are a minimal diff — the document is compared to what was
  stored and only what moved is written.

### Time

- **Dates and recurrence.** Due and start dates with a time, repetition by
  RFC 5545 rule in two modes: on the calendar, or counted from when you
  actually finish. Ticking a repeating task advances it instead of closing it.
  Instants are stored in UTC with the zone beside them, so a 09:00 meeting is
  still at 09:00 after the clocks change.
- **A calendar** in day, work week, week, month and agenda, over the same
  items and events: a now line, working-hours shading, an all-day lane,
  Outlook-style overlap layout, and events that move by drag or by keyboard.
- **Time blocking** — the move none of the four products this competes with
  makes. Drag a task onto the grid, or press its Reserve button and use the
  arrow keys, and it becomes reserved time while staying the same task.

### Getting things in and out of your head

- **Quick capture.** `Ctrl+Alt+Space` in any program opens a one-line window
  over whatever is on screen. Plain words become the task's date, time, repeat
  rule, priority and reminder — "Pay rent on friday at 9am !high remind me 15m
  before" — and every phrase is shown as a chip before you press Enter, so what
  was understood is visible and can be put back.
- **A command palette** on `Ctrl+K`: every command the product has, ranked by
  the letters you type, and one search over tasks and events through a
  full-text index — prefix matching, accent-insensitive, matched words marked.
- **Windows reminders.** A native toast at the time you asked for, with
  Complete, Snooze and Open on it. Closing the window keeps them coming: the
  tray holds the process, and Quit in its menu is what ends it. Reminders that
  came due while Tessera was closed fire on the next start, grouped into one
  toast when there are several. Start with Windows is available and off by
  default.

### Your data

- **One SQLite file you own**, in WAL mode, with forward-only numbered
  migrations. A database written by an older build opens in this one, migrated,
  without loss.
- **Backups.** A compacted copy on the first start of each day and on request,
  kept in rotation beside the workspace. Restore from the list or from any
  file; a backup of the current state is taken first, so a restore can itself
  be undone.
- **Export and import.** JSON is the whole workspace, every table and every
  column, and the only form that imports — import replaces, never merges, and
  says what the file holds before it does. Markdown for tasks and notes;
  iCalendar for events and dated tasks.

### How it looks and how it is reached

- **Fluent, on Windows 11.** Mica behind the window, your desktop accent
  colour, light and dark, two densities, and a title bar the application draws
  itself.
- **WCAG 2.1 AA, held by gates rather than by review.** Contrast is a unit test
  over the token file in both themes; axe-core audits every screen in both
  themes in the end-to-end suite; and the product is driven by keyboard alone
  in the same suite — including reserving time on the calendar. Anything that
  changes without a click is announced.

### Known limits

- The installers are not code-signed, so Windows SmartScreen warns on first
  run (ADR-015).
- Snap Layouts — hovering the maximise button to choose a layout — does not
  appear, because a WebView2 child window answers the hit test for the caption
  buttons.
- On a machine without the WebView2 runtime, the installer fetches it, which
  needs a network connection **once**, at install time. Windows 11 always has
  it. Nothing the product does afterwards touches a network.
- What is deliberately not here: sync, collaboration, mobile, macOS and Linux,
  formulas, relations between collections, Timeline and Gantt, attachments,
  automatic updates, and AI.
