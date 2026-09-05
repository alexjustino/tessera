# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.1.0] — 2026-09-04

The project manager. 1.0 was a workspace for tasks, projects and time; 1.1 is
what lets it plan: tasks that wait for one another, a critical path with slack,
milestones, a timeline you can drag, a year coloured by how full each day is,
a clock on every task, reports where every number opens onto its rows,
templates that keep the shape of work, and a focus mode with one task and
nothing else on the screen. Still entirely on your machine.

### Migrations

This release adds migrations **008** (`item_dependency`), **009** (`is_milestone`
on items), **010** (the `view` table rebuilt to admit the timeline; every row,
its configuration and its order kept), **011** (`time_entry`, with the
one-running-timer rule as a partial unique index) and **012** (`template`).
All forward-only. A 1.0.0 workspace — schema version 7 — opens in 1.1.0 and is
migrated to 12 on first start; the round-trip test walks every version writing
rows at each, and the end-to-end suite opens a real 1.0.0 file in the 1.1.0
binary and finds everything it held.

### Added

- **Focus mode.** One task, its timer, and nothing else on the screen. Enter
  it from a task's panel or from the palette; the rail and the list go away,
  and what is left is the title, a clock you can read from across the room,
  and four things to do: start or stop the clock, mark the task done, move to
  the next task that is ready, or leave. Escape always leaves.

  Which task is shown follows one rule: the one you pointed at, else the one
  the clock is on, else the first task that is ready to start — open, not
  waiting on anything unfinished, and not a milestone. Nothing starts the
  clock for you; focusing is a decision, and so is timing.

- **Go to Reports** in the palette, which the Reports slice forgot to add.

- **Templates.** Save what the view is showing as a template — the tasks,
  their estimates, which are milestones, which wait for which, and how the
  dates fall relative to the first — and make it again on any day. Applying
  asks for one thing, the day it starts; every date moves with it, keeping
  its time of day across month ends, year ends and the clocks changing. The
  dependencies come too. Everything is made in one step or not at all.

- **Reports.** A page of its own: a week or a month, and what it held. Time
  tracked — in total, by task and by day, split at midnight; tasks completed;
  for the tasks worked on, everything ever tracked beside the estimate; and
  what the calendar reserved against the working hours the period had.

  **Every number can be opened.** A figure is a button; pressing it lists the
  rows it was added up from, each with its own contribution, so the total can
  be checked by eye. The domain promises the rows sum to the figure, the page
  checks it on every render, and a figure that did not add up would show a
  dash and say so rather than the number (ADR-024).

- **Time by hand.** An entry can be added without the clock — "I did two hours
  on this yesterday" — and an entry the clock did record can be corrected. A
  running entry that is corrected stops: editing the times of a clock is not
  asking it to keep going. An end before its start is refused in words, by the
  form, by the host, and by the schema.

- **The year view.** A sixth calendar scale: twelve months, every day a cell,
  each coloured by how much of its working hours the calendar has reserved.
  The shade is never the only cue — every cell names its day and its load in
  words, the legend says what each shade means, and a day with more reserved
  than it has gets a ring as well as a colour. A cell opens the day.

- **Daily capacity.** The working hours already in the workspace are what a
  day has; what the calendar has reserved — events with a time, and the
  blocks that hold time for a task — is what a day has used. The year view
  says how much of the year is spoken for, month by month and in total, and
  counts the days that are over. Nothing is estimated: a task with an estimate
  and no time reserved is not on the calendar, so it is not on the map
  (ADR-023).

- **Time tracking.** Start a clock on a task from its detail panel and stop it
  there; the row wearing the clock says **Timing**. One timer runs at a time —
  starting a task stops whatever was running, and the panel names the task it
  would interrupt before the button is pressed. A running timer survives
  closing the application: it was never held in memory, only in the workspace.

  The task shows what it has taken, how that compares to its estimate, and
  what has been tracked today across everything. An entry that crosses
  midnight is counted on both days it touched, and the two days a year that
  are not twenty-four hours long add up to what they were.

- **The timeline.** A fifth view: a row per dated task in dependency order, a
  bar from each task's own dates, an arrow for every dependency, and the
  critical path coloured. Move a bar by dragging it or by pressing Move and
  using the arrow keys — both shift the start and the due date together, and
  the dates are the plan.

  A dependency the dates contradict is drawn as a broken arrow and counted at
  the top. A task with no due date is not given an invented place: it is
  counted under the chart.

- **The critical path.** Give tasks estimates — typed the way you say them,
  `2h 30m`, `1d`, `45` — and Tessera says how long the longest route through
  the work is, which tasks decide the end, and how much slack the rest have. A
  task can be marked a **milestone**: a moment in the plan rather than work,
  with no duration whatever its estimate said.

  The number says what it is worth. A plan nobody has estimated shows nothing
  rather than marking every task critical, and a path with gaps says how many
  of its tasks have no estimate.

- **Dependencies.** A task can wait for another: state it in the detail panel,
  see what a task is waiting for and what waits on it, and take it back. A row
  that is waiting says so. The graph stays acyclic — the picker offers only what
  would not close a loop and says what it is leaving out, and the workspace
  refuses one anyway, whatever asked (ADR-019).

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
