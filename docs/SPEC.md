# Tessera — product specification, v1.0.0

The single source of what the product is and what "done" means for it. Architecture rationale
lives in [`architecture/ADR.md`](architecture/ADR.md), the schema in
[`DATA_MODEL.md`](DATA_MODEL.md), the UI contract in [`../DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md).

## 1. Thesis

Four products own this space, and each is right about exactly one thing. **Microsoft To Do**
nails frictionless capture and a native reminder, and is otherwise a dumb list. **Trello** has
the best visual metaphor for flow, and nothing else. **Notion** has the correct data model, and
is slow and cloud-bound. **Outlook** has the reference calendar, and keeps tasks and time in
separate worlds.

> One typed data core, many views over it, a block document inside every item, a real calendar
> beside it, and the zero friction of a good to-do list on top — local, instant, offline,
> shaped like a native Windows 11 application.

The move none of the four make: **drag a task into the calendar and it becomes reserved time,
while still being the same task.**

## 2. Scope

### In 1.0.0

1. **Typed core** — collections, items, typed properties, sub-items, tags.
2. **Views** — List, Table, Board (Kanban), Calendar; filters, sorting and grouping saved per view.
3. **Block editor** — the item is a document: paragraphs, headings, lists, to-dos, quote, code
   with syntax highlighting, divider, callout, toggle, table, local image, columns, mentions.
4. **Planning** — start and due dates, RRULE recurrence in both modes, Inbox / Today /
   Next 7 days / Overdue.
5. **Calendar** — day, work week, week, month, agenda; all-day lane; drag to create, move and
   resize; Outlook-style overlap layout; now-line; working-hours shading; mini navigator;
   categories; multiple overlaid calendars; **time-blocking**.
6. **Windows alerts** — tray icon with a badge, a "Today" flyout, native toast with Complete /
   Snooze / Open, a scheduler that survives sleep and resume, start-up catch-up, optional
   autostart, single instance.
7. **Quick capture** — global hotkey, floating window, natural-language parsing with live chips.
8. **Command palette** and full keyboard reach.
9. **Search** — FTS5 over titles and block text.
10. **Data** — rotating backup, export and import (JSON, Markdown, ICS).
11. **Settings, Diagnostics and About** — including the story of the name.
12. **Windows installer** (MSI and NSIS).

### Deliberately not in 1.0.0

Sync and cloud · collaboration · mobile · macOS and Linux · formulas and rollups · relations
between collections (the schema anticipates them; the UI does not deliver them) · Timeline and
Gantt · arbitrary attachments · auto-update · AI.

> **Nothing enters 1.0.0 without something leaving it.** "Better than four products" is an
> infinite target; the release train is how it ships.

### The release train

| Release   | Theme               | Contents                                                                                                                                          |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0.0** | The workspace       | the list above                                                                                                                                    |
| 1.1.0     | The project manager | year view · timeline and Gantt · dependencies with critical path · milestones · time tracking · focus mode · reports · templates · daily capacity |
| 1.2.0     | The adopter         | importers (Microsoft To Do, Trello, Notion, Todoist, ICS) · notes and wiki space · goals · print and PDF export · GTD review                      |
| 2.0       | Only if it earns it | opt-in end-to-end-encrypted sync · macOS and Linux                                                                                                |

## 3. Architecture

```
src-tauri/  (Rust — only what needs the operating system)
  db/        migrations · repositories (CRUD + FTS5 + transactions)
  os/        tray · notifications · scheduler · accent colour · window effects
  commands/  #[tauri::command] — the typed boundary
src/  (TypeScript)
  data/      command client + TanStack Query — the only layer that knows @tauri-apps
  domain/    entities · query engine · recurrence · calendar layout · timezone
             arithmetic · natural-language parser · ordering — PURE
  ui/        design system: tokens and canonical primitives
  features/  one directory per module
  app/       composition, routes, shortcuts, window lifecycle
```

**The boundary rule** (ADR-003): `src/domain/` never imports `data/`, `ui/`, `features/`,
`react` or `@tauri-apps/*`. Enforced by ESLint and by an architecture test in CI. A rule with
one gate is a rule that eventually gets bypassed.

The consequence that matters: **calendar overlap layout and recurrence expansion are pure
functions**, unit-testable without mounting a component. That is where calendars go wrong, and
that is where the tests are.

## 4. Non-functional requirements

| Requirement            | Target                               | How it is measured                                                       |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| Cold start             | < 1.5 s to a usable window           | release build, timed                                                     |
| Switch view            | < 100 ms                             | 50,000-item seed                                                         |
| Render a calendar week | < 50 ms                              | 500 events in the week                                                   |
| Typing in the editor   | no dropped frames                    | 500 blocks                                                               |
| Volume                 | 50k items · 200k blocks · 20k events | synthetic seed in CI                                                     |
| Installer              | < 20 MB                              | release gate                                                             |
| **Never lose data**    | **requirement one**                  | WAL · rotating backup via `VACUUM INTO` · full export · **restore test** |

A to-do application that loses a task is dead. Backup and export are not a version-two feature.

## 5. Security and privacy

No network. No account. No telemetry, analytics, crash reporting or update check. The Tauri CSP
blocks external origins; capabilities are declared one by one and **shell execution is
deliberately absent**; filesystem access is scoped to the application data directory.

Imported files from other products are treated as hostile data: never-throwing parsers, size
limits, no execution, no following external references.

The diagnostic bundle carries logs, schema and counts — **never** the content of tasks, notes or
events.

Stated plainly, and out of the threat model: the database is not encrypted at rest in 1.0.0.
Anyone with your Windows account can read it. Use BitLocker if that matters.

## 6. Testing and gates

| Level        | Tool                         | Target                                                                                                                                                      |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules        | Vitest over `domain/`        | **≥ 90%** — recurrence and exceptions, occurrence expansion, calendar overlap, timezone and DST arithmetic, query engine, natural-language parser, ordering |
| Persistence  | `cargo test`                 | CRUD, transactions, FTS, **migration round-trip**                                                                                                           |
| Contract     | Vitest over `data/`          | the Zod shape matches the Rust serde shape                                                                                                                  |
| End-to-end   | WebdriverIO + `tauri-driver` | create → move on the board → **drag into the calendar** → restart → still there                                                                             |
| Architecture | own test                     | fails if `domain/` imports React or Tauri                                                                                                                   |

**Mandatory negative cases** for anything touching time: month boundaries, leap years,
**daylight-saving transitions**, events crossing midnight, a cancelled occurrence inside a
series, unbounded recurrence, and the timezone changing while the application is open.

```
cargo fmt --check · cargo clippy -D warnings · cargo test
tsc --noEmit · eslint (react-hooks/rules-of-hooks = ERROR) · prettier --check · vitest
```

One script, `npm run gates`, run identically by a developer and by CI.

## 7. Vertical slices

Depth before breadth. F1 crosses Rust → SQLite → commands → domain → UI in a single feature: if
the architecture is wrong, that shows on day two rather than day sixty.

| #      | Slice                                                                | Proof of done                                                                                                            |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **F0** | Foundation and the Fluent shell                                      | gates green · window with Mica and the system accent in both themes · **a toast with buttons appeared beside the clock** |
| F1     | The vertical slice — create a task, persist, list, complete, restart | end-to-end passes; no layer skipped                                                                                      |
| F2     | Typed properties, inline editing                                     | every type round-trips                                                                                                   |
| F3     | Query engine, List and Table, saved views                            | filter under 50 ms on a 50k seed                                                                                         |
| F4     | Kanban board                                                         | dragging changes the property; order persists; keyboard drag works                                                       |
| F5     | Block editor                                                         | document round-trips without loss; 500 blocks stay smooth                                                                |
| F6     | Dates and recurrence                                                 | the negative-case battery is green                                                                                       |
| F7     | Calendar and time-blocking                                           | dragging a task onto the grid creates a linked block; 500 events under 50 ms                                             |
| F8     | Windows alerts                                                       | **host proof on an installed build**                                                                                     |
| F9     | Quick capture, palette, search                                       | a task in under five seconds without opening the app                                                                     |
| F10    | Data, Settings, **About**                                            | a restored backup restores everything                                                                                    |
| F11    | Fluent polish and accessibility                                      | every screen opened for real, both themes, keyboard                                                                      |
| F12    | Release 1.0.0                                                        | the installer runs on a clean machine                                                                                    |

## 8. Definition of done

A slice is done when **all eight** are true.

1. Gates green. No exceptions, no "I'll fix it after".
2. Tests cover the new rule, **including the negative case**.
3. Documentation synchronised with the code that actually shipped.
4. **Verified running** — the screen was opened in both themes; the toast actually appeared.
   Done is somebody looking at the screen, not a green pipeline.
5. Design system gate: one token source, canonical primitive, official icon set. Nothing
   approximated by hand.
6. Accessibility: keyboard reachable, focus visible, contrast checked.
7. No secrets and no internal references in the public repository.
8. Conventional Commits, one concern each, staged per file.

## 9. Risks

| #   | Risk                                                                                 | Severity     | Mitigation                                                                                             |
| --- | ------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------ |
| R1  | The expanded scope overruns                                                          | High         | the release train; 1.0.0 is a closed list                                                              |
| R2  | An Outlook-grade calendar is underestimated — recurrence, exceptions, zones, overlap | High         | pure testable engine; RRULE and timezones from libraries; the negative-case battery gates F6 before F7 |
| R3  | The block editor becomes a small Notion                                              | High         | TipTap rather than from scratch; the block list is closed                                              |
| R4  | Windows toast identity does not behave as assumed                                    | High         | **probed in F0 from an installed build**, week one                                                     |
| R5  | Mica unavailable on some machines                                                    | Medium       | declared fallback to a solid token surface                                                             |
| R6  | In-memory filtering stops scaling                                                    | Medium       | 50k seed in F3; measured trigger; `Query → Item[]` already shaped for push-down                        |
| R7  | **Data loss**                                                                        | **Critical** | WAL · rotating backup · export · restore test                                                          |
