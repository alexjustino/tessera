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

### 1.1.0 — the project manager

1.0 answers "what do I do today". 1.1 answers "will this finish, and when" — which
is a different question about the same rows, and the reason it is a minor release
rather than a second product: no new data core, one new relation and the views
that read it.

The order is not the roadmap's order. Dependencies come first because the
timeline, the critical path and the capacity figures are all readings of the same
graph, and a view built before the graph is a view that gets rewritten.

| #      | Slice                            | Proof of done                                                                             |
| ------ | -------------------------------- | ----------------------------------------------------------------------------------------- |
| **P1** | Dependencies                     | a cycle is refused in words, by the interface _and_ by the host; order survives a restart |
| P2     | Milestones and the critical path | the path and the slack are right on a graph a person can check by hand                    |
| P3     | Timeline (Gantt)                 | 500 items lay out inside the frame budget; dragging a bar changes the dates               |
| P4     | Time tracking                    | a running timer survives a restart; the day's sum is right across midnight                |
| P5     | Year view and daily capacity     | a year renders inside the budget; capacity reads the working hours already there          |
| P6     | Reports                          | every number can be traced to the rows it came from                                       |
| P7     | Templates                        | a template with dependencies keeps them, with the dates rebased                           |
| P8     | Focus mode                       | one task, its timer, and nothing else on the screen                                       |
| P9     | Release 1.1.0                    | a 1.0 workspace opens in 1.1, migrated, without loss                                      |

What 1.1 deliberately does not add: a second data core, resource assignment
(there is one person), or a scheduler that moves work on its own. A dependency
says what must come first; it does not get to decide your day.

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

### Deferred out of P3, and why

The timeline draws the plan and edits it. What a Gantt could also do:

- **Resize a bar** to change its length. Moving works; stretching needs a
  second grab affordance and a decision about which end moves — the same shape
  the calendar deferred in F7, and worth doing once for both.
- **Zoom.** The grid is one column per day. Weeks and months are a scale
  factor, and a quarter at day resolution already scrolls further than anyone
  wants to drag.
- **Rescheduling what a move breaks.** Moving a task can leave a dependency
  contradicted; the chart says so and changes nothing else. A plan that moves
  work on its own is exactly what 1.1 said it would not do.
- **Grouping and filtering.** The timeline reads the view's query but ignores
  its grouping; a grouped Gantt wants swimlanes, which the board deferred too.
- **A today marker that scrolls into view.** Today is ruled and coloured, but
  the chart opens at the beginning of the window rather than at now.

### Deferred out of P2, and why

The plan is computed, correct on a graph a person can check by hand, editable
on a task and visible on a row. What it does not do yet:

- **Put the plan on a calendar.** The timings are minutes from the start of the
  project, not dates: "four hours of work" rather than "finishing on Thursday".
  Turning one into the other needs working hours and non-working days, which is
  P5's subject.
- **The critical path in the board, the table and the calendar.** The list
  shows it; P3 is where the graph becomes a picture and the other views get
  their own treatment rather than the same chip dropped in.
- **Estimates in the quick-capture grammar.** `Build it 2h` would fit the
  parser, and belongs with a look at the whole grammar rather than bolted on.
- **Rolling an estimate up from subtasks.** `parent_item_id` has existed since
  the first migration and nothing uses it; a plan that sums children is worth
  having once subtasks are a real feature rather than a column.

### Deferred out of P1, and why

The graph is stored, refused when circular, edited on a task and visible on a
row. What dependencies could also be and are not yet:

- **A "Waiting" indicator on the board and the table.** The list shows it; the
  other two views want their own treatment rather than the same chip dropped in,
  and the timeline (P3) is where the graph becomes a picture.
- **Kinds of dependency** — start-to-start, finish-to-finish, lag. One relation
  that means one thing until something asks for more.
- **A view of what is ready to start.** `readyToStart` is written and tested; it
  wants the focus mode (P8) to be the screen that uses it.
- **Dependencies across collections.** The schema allows it; the picker only
  offers tasks from the one on screen, because a cross-collection picker is a
  search box, and that is a design rather than an oversight.

### Deferred out of F12, and why

1.0.0 ships: the version is one fact held by a gate, the migration round-trip
runs against a file, the release budgets are tests, and the installers are
built from a tagged commit by the workflow rather than from a developer
machine. What a release could also have and does not:

- **Code signing.** A certificate is a recurring commercial cost that changes
  the first-run experience and not the security properties (ADR-015). Until
  then SmartScreen warns, and the README says so.
- **Automatic updates.** The updater needs signing keys and an endpoint to
  serve from; both arrive together, after signing.
- **An embedded WebView2 runtime.** The installer bootstraps it instead, which
  needs a network connection once on a machine that lacks it. Embedding would
  take a three-megabyte installer past a hundred and thirty, against a stated
  twenty-megabyte budget.
- **A verified install on a genuinely clean machine.** The suite drives the
  release binary on a workspace it creates from empty, which proves the
  migrations and the product; a machine with no WebView2, no Visual C++
  runtime and no developer tools is a different claim, and needs a real one.

### Deferred out of F11, and why

Every screen is opened by the suite in both themes and audited; the keyboard
reaches the calendar; contrast is a test; dialogs behave. What is listed under
polish and accessibility and is not in the first version:

- **Snap Layouts on the maximise button.** Windows shows the flyout when a
  window answers `HTMAXBUTTON` to `WM_NCHITTEST`, but the cursor is over the
  WebView2 child window, which answers for itself; its non-client region support
  covers the caption drag (`app-region: drag`) and not the caption buttons. Until
  WebView2 exposes that, maximising works and the flyout does not appear.
- **Keyboard moves in the month and agenda views.** Both are read-only today;
  the time grid is where blocks move, and that is where the keyboard works.
- **Tooltips as a primitive.** Every icon control has a name and a `title`;
  a styled `Tooltip` with a delay and an arrow is presentation on top of that.
- **Windows high-contrast (forced colours) mode** was not verified by a person.
- **A screen-reader pass by a person** (NVDA, Narrator). The live regions and
  names are in place and audited; how they _sound_ needs ears.

### Deferred out of F10, and why

Settings, backups, restore, export and import ship end to end, with the
restore test the slice was named for. What is listed in the scope and is not
in the first version:

- **Choosing the backup folder.** Backups live beside the workspace file, where
  they are found by the same relocation the workspace uses. A second location —
  a synced folder, another drive — is a preference for a later slice; Explorer
  is one click away meanwhile.
- **Importing other products' files.** Microsoft To Do, Trello, Notion, Todoist
  and ICS importers are the 1.2 theme; only Tessera's own export imports today.
- **Merging on import.** Import replaces the workspace. Merging two histories
  of the same identifiers is a synchronisation problem, and the product does
  not pretend to have solved it (ADR-017).
- **Moved occurrences in the iCalendar export.** Cancelled occurrences go out as
  `EXDATE`; a moved one would need `RECURRENCE-ID` and its own `VEVENT`, and
  is written down here rather than exported half-right.
- **Exporting from the command palette** and a keyboard shortcut for "back up
  now" — both a screen away in Settings.

### Deferred out of F9, and why

Quick capture, the palette and search ship end to end: a global shortcut, a
floating window, a stated grammar with live chips, one index over tasks and
events, and a suite that drives the real binary. What is listed in the scope
and is not in the first version:

- **Choosing the shortcut.** It is `Ctrl+Alt+Space`, fixed. A preference belongs to
  Settings, which is F10; until then Diagnostics says whether the key registered
  and the tray menu and palette are the fallback.
- **Capturing into a collection other than Tasks**, or with a note body. One
  collection exists today; the request shape already carries the collection.
- **Acting on a search hit from the palette** — complete, snooze, reschedule.
  Enter opens the item; the actions are one screen away.
- **Grammar in other languages.** The parser is English, stated in full in its
  header. Portuguese is the first candidate and follows the interface's i18n.
- **Pressing the global shortcut in the end-to-end suite.** WebDriver speaks to
  the page, not to the operating system; the suite summons the window through
  the same command the tray uses and proves the rest. The key itself is proved
  by Diagnostics reporting its registration, and by a person pressing it.

### Deferred out of F8, and why

The alert pipeline ships end to end: reminder rows, a scheduler that survives a
closed laptop lid, native toasts with working buttons, the tray, autostart and
catch-up. What is listed in the scope and is not in the first version:

- **The "Today" flyout on the tray.** A compact Acrylic panel is its own window
  with its own lifecycle; the tray menu's _Today_ opens the main window on the
  Today view instead, which is the same information one click further away.
- **A badge on the tray icon.** Windows does not give an ordinary application a
  badge there. The count lives in the tooltip — visible on hover, honest, and
  not a fake overlay drawn onto the icon.
- **The global hotkey** belongs to quick capture, which is F9.
- **Toast buttons after the process has exited.** A button on a toast that is
  still in the Action Center after Tessera was quit has nothing to talk to; it
  opens the application. That is a Windows COM-activator problem, and it is
  named here rather than left to be discovered.

### Deferred out of F7, and why

The calendar ships with its grid, its layout and its time-blocking. What is
listed in the scope and is not in the first version:

- **Resize to change duration.** Moving works; stretching needs a second drag
  affordance and its own snapping.
- **Drag on empty space to create.** The same machinery as resize.
- **The mini navigator.** Navigation works by arrows and Today; a month-strip
  navigator is presentation on top of that.
- **Categories, multiple overlaid calendars, and a secondary timezone.** The
  schema carries all three — one calendar is seeded, and its colour already
  flows through — but the interface for managing them does not exist yet.
- **The "this occurrence / this and following / all" dialog.** The exceptions
  behind it are built and tested; what is missing is the question.
- **Year view with a workload heat map**, which the release train puts in 1.1.

Two of those are worth separating from the rest: the exception model and the
calendar colour are already complete underneath. What is missing there is a
screen, not a mechanism.

### Deferred out of F5, and why

Four things listed under the editor are not in the first version:

- **Drag handle to reorder blocks.** The ready-made extension is paid; a
  hand-written one is a node-view of its own and belongs in its own slice. The
  ordering underneath already supports it — `diff` repositions only what moved.
- **Toggle and columns.** Both are nested layout nodes rather than styling, and
  each needs its own schema and keyboard behaviour.
- **Mentions with backlinks.** These are the foundation of the notes space in
  1.2, and are better designed with it than bolted on before it.
- **Smart paste from Word and Outlook.** Worth doing properly, with real
  documents to test against.

### Deferred out of F4, and why

Three things listed under the board in the scope are **not** in the first board,
and are recorded here rather than quietly dropped:

- **Swimlanes.** A second grouping axis. The query engine groups on one field;
  a second one is a real change to `run`, not a rendering trick, and it belongs
  in its own slice.
- **Card covers.** Need an image, which arrives with the block editor in F5.
- **Checklists on a card.** Need sub-items rendered as a list, which the detail
  panel gets first.

None of them changes the shape of what is built; each is additive.

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
