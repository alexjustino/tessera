# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Deleting an item now removes its document and its search-index rows. They key
  on owner rather than a foreign key, so nothing cascaded on its own and the
  database leaked a row per paragraph.
- `item.status_id` is gone. Status is a property like any other; the column was
  speculative and was never written to.

### Added

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
