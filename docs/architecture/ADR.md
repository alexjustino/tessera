# Architecture Decision Records

Binding decisions. A record here is not a suggestion: changing one requires a new record that
supersedes it, not an edit in passing. Each entry states the context, the decision, and — the
part that matters most later — the cost we accepted.

| #               | Decision                                          | Status   |
| --------------- | ------------------------------------------------- | -------- |
| [001](#adr-001) | Tauri 2 with a deliberately thin Rust host        | Accepted |
| [002](#adr-002) | SQLite, one file, WAL                             | Accepted |
| [003](#adr-003) | The domain layer is pure TypeScript               | Accepted |
| [004](#adr-004) | The view query engine runs in memory              | Accepted |
| [005](#adr-005) | Properties are stored entity-attribute-value      | Accepted |
| [006](#adr-006) | Ordering uses fractional indexing                 | Accepted |
| [007](#adr-007) | Recurrence is RRULE plus a mode                   | Accepted |
| [008](#adr-008) | An event is not an item                           | Accepted |
| [009](#adr-009) | The block editor is built on TipTap / ProseMirror | Accepted |
| [010](#adr-010) | Fluent is the visual language, with one icon set  | Accepted |
| [011](#adr-011) | Apache-2.0                                        | Accepted |
| [012](#adr-012) | No network, no telemetry                          | Accepted |
| [013](#adr-013) | Time is stored in UTC with an IANA zone           | Accepted |
| [014](#adr-014) | The calendar engine is ours                       | Accepted |
| [015](#adr-015) | Installers are not code-signed in 1.0.0           | Accepted |

---

## ADR-001 — Tauri 2 with a deliberately thin Rust host {#adr-001}

**Context.** The product must feel native on Windows: a tray icon, toasts that reach the
Action Center, autostart, a global hotkey, Mica. It must also start fast and stay small.

**Decision.** Tauri 2, with the Rust side kept as thin as it can be: storage, the operating
system, and the typed command boundary. No business logic in Rust.

**Why not Electron.** A ~10 MB binary against ~150 MB, and WebView2 is already on every
Windows 11 machine. **Why not WPF/WinUI.** The view engine, the block editor and the calendar
are far cheaper to build well in the web stack, and the team already knows it.

**Cost accepted.** Rust is a second language in the build, and the WebView is not identical
across Windows versions. Both are contained by keeping the Rust surface small.

## ADR-002 — SQLite, one file, WAL {#adr-002}

**Decision.** `rusqlite` with the bundled SQLite (so the build does not depend on a system
library), FTS5 for search, WAL journaling, `synchronous = NORMAL`, foreign keys on.

**Why.** A local-first product needs a store that is transactional, serverless, and a single
file the user can copy. WAL keeps readers from blocking the writer and survives a hard kill far
better than the rollback journal.

**Cost accepted.** `NORMAL` is durable across an application crash but can lose the last
transactions on sudden OS power loss. That is the standard trade for the write throughput a
responsive editor needs, and it is why backups are a first-release feature and not a later one.

## ADR-003 — The domain layer is pure TypeScript {#adr-003}

**Decision.** `src/domain/` holds entities, the query engine, recurrence expansion, calendar
overlap layout, timezone arithmetic, the natural-language parser, fractional indexing and
report aggregation. It imports no React, no `@tauri-apps/*`, no outer layer, and performs no
I/O.

**Why.** These are the parts of the product that are actually hard, and the parts where
calendars usually go wrong. Purity makes them testable without mounting a component or opening
a window, which is the difference between a suite that catches a daylight-saving bug and one
that does not.

**Enforcement.** Twice, deliberately: ESLint `no-restricted-imports` while editing, and
`src/domain/boundary.test.ts` in CI where it cannot be silenced with a disable comment.

## ADR-004 — The view query engine runs in memory {#adr-004}

**Context.** A view is filters, sorts and grouping over a collection. It could compile to SQL
in Rust or run over an in-memory store in TypeScript.

**Decision.** In memory, in TypeScript, over a store hydrated from SQLite.

**Why.** At tens of thousands of items the cost is irrelevant, and it keeps every business
rule in one pure, testable place rather than duplicated across two languages with dynamic SQL
in between.

**Cost accepted, and the exit.** This does not scale forever. The contract is
`run(input) → Result`; when it stops being fast enough, a compiler emits SQL behind the same
contract. The measured trigger is a 50,000-item seed: a filter above 50 ms brings the
push-down forward.

**Measured in slice F3** (`src/domain/query.bench.test.ts`, 50,000 items, best of five):

| Operation              | Best      | Against the 50 ms target |
| ---------------------- | --------- | ------------------------ |
| Filter by one option   | **20 ms** | within, 2.5× headroom    |
| Filter title contains  | **18 ms** | within                   |
| Group by status        | **41 ms** | within                   |
| Filter, sort and group | 59 ms     | over                     |
| **Sort by priority**   | **85 ms** | **over**                 |

The trigger is met: filtering is comfortably inside it, so the push-down stays future work.
Sorting is the outlier and is recorded here rather than left as a surprise — it is the first
candidate when the compiler is written, and 50,000 is a stress ceiling rather than an expected
size.

Two lessons from taking the measurement, both worth more than the numbers:

- The first version of the ordering path looked up each row with `find` inside a `map`. That
  is quadratic: invisible at twenty rows, around two billion comparisons at fifty thousand.
  The benchmark existed for exactly this.
- Single-shot timings on a working laptop varied by 30%, which was larger than any of the
  optimisations being evaluated — so two of them were applied against noise and cannot be
  credited with the improvement. The benchmark now reports the best of five runs. **Build the
  reliable measurement before optimising against it.**

## ADR-005 — Properties are stored entity-attribute-value {#adr-005}

**Decision.** `item_property_value(item_id, property_id, value_json)`.

**Why.** The user creates and deletes typed properties at will. The alternative is dynamic DDL
— a column per property — which is worse to migrate, worse to back up, and worse to reason
about.

**Cost accepted.** EAV is famously slow to query in SQL. It does not bite here because
filtering happens in memory (ADR-004). If a profile ever demands it, the three to five most
queried properties get materialised into columns; the schema does not otherwise change.

## ADR-006 — Ordering uses fractional indexing {#adr-006}

**Decision.** `position` is a string key over a 62-digit alphabet whose ASCII order is its
logical order. A new key can always be generated strictly between any two.

**Why.** With integer positions, dragging one card rewrites every row after it. With fractional
keys, a move is one UPDATE of one row regardless of list length, and sorting is plain
lexicographic comparison that both SQLite and JavaScript agree on.

**Cost accepted.** Keys grow slowly under pathological insert patterns (always inserting at the
same point). The invariant "a key never ends in the lowest digit" is enforced, and the growth is
logarithmic in practice. Implementation and its property tests: `src/domain/ordering.ts`.

## ADR-007 — Recurrence is RRULE plus a mode {#adr-007}

**Decision.** Store the RFC 5545 `RRULE` string, plus `recurrence_mode ∈ {schedule,
after_completion}`, plus an exception table. Occurrences are computed, never materialised.

**Why.** RRULE is the interchange standard, so import and export are not a translation layer.
`after_completion` ("three days after I finish it") is what people actually want for
maintenance work and is what Microsoft To Do cannot express. Materialising occurrences would
turn one weekly task into thousands of rows and make "edit all following" impossible.

## ADR-008 — An event is not an item {#adr-008}

**Context.** It is tempting to collapse everything into `item` and let properties carry the
difference.

**Decision.** `event` is its own table. An **item is a unit of work**; an **event is a unit of
time**.

**Why.** An event has a start _and_ an end, a timezone, recurring occurrences with per-occurrence
exceptions, and overlap against its neighbours. Forcing that through EAV makes the calendar slow
and the task model muddy — both get worse.

**What is shared, and it is the important half.** The same block editor
(`block.owner_kind`), the same reminder pipeline (`reminder.owner_kind`), the same search index
and the same activity trail. `time_block` bridges them: dragging a task into the calendar
creates an event that still refers to the task. That bridge is the product's differentiator, and
it works precisely because the two models stayed honest about being different.

## ADR-009 — The block editor is built on TipTap / ProseMirror {#adr-009}

**Decision.** TipTap 2 over ProseMirror, not a hand-written editor.

**Why.** ProseMirror enforces document integrity through a schema, which is the difference
between an editor that survives paste, undo and concurrent edits and one that corrupts a
document at the worst moment. A hand-written block editor is the single largest source of
schedule overrun in a product like this.

**Alternative considered.** Lexical. Rejected on ecosystem and documentation maturity for the
block-level features required, not on quality.

## ADR-010 — Fluent is the visual language, with one icon set {#adr-010}

**Decision.** Fluent 2 / Windows 11: Mica window material, Acrylic flyouts, the system accent
colour read live from Windows, Segoe UI Variable, Fluent motion curves and durations, four
elevation steps. Icons come from **Fluent UI System Icons** — one set, never mixed.

**Why.** The product should look like it belongs on the desktop it runs on, not like a web page
in a frame. Reading the user's own accent colour is what sells it.

**Enforcement.** `DESIGN_SYSTEM.md` is a contract, not advice. A component never writes a raw
value; if it is not a token, it does not exist. Native capability that is unavailable degrades
**visibly** — Mica falls back to a solid token surface, and the accent ramp reports
`from_system: false` rather than pretending.

## ADR-011 — Apache-2.0 {#adr-011}

**Decision.** Apache License 2.0, `Copyright 2026 Alex Justino`, with a `NOTICE` file and a
trademark statement in the README.

**Why, over MIT.** Both are permissive and both keep authorship. Apache-2.0 adds three things
MIT does not: an explicit statement that the licence grants no right to the project's name or
marks (§6); an obligation on redistributors of modified copies to say that they modified it;
and an explicit patent grant with a retaliation clause. For a named product with a single
author, those are gains at a cost of one extra file.

**Why not GPL.** Preventing closed forks is not a goal here; adoption is.

## ADR-012 — No network, no telemetry {#adr-012}

**Decision.** The application makes no outbound request. No account, no sync, no analytics, no
crash reporting, no update check. The Tauri CSP blocks external origins and capabilities are
declared one by one, with shell execution deliberately absent.

**Why.** Privacy is a feature of this product, stated in the README, not an omission. It is
also what makes the security posture simple enough to be true.

**Cost accepted.** No automatic updates in 1.0.0. Releases are downloaded from GitHub.

## ADR-013 — Time is stored in UTC with an IANA zone {#adr-013}

**Decision.** `starts_at_utc` plus an IANA zone identifier (`America/Sao_Paulo`). Never local
wall-clock time in the database. All-day events are the single declared exception: a local date
with no time.

**Why.** Daylight-saving transitions and travel between zones break naive calendars in ways
users never forgive — a recurring 09:00 meeting must stay at 09:00 local after the clocks
change, which is only expressible if the rule and the zone are both stored.

**Consequence.** Timezone arithmetic lives in `src/domain/`, and the DST transition tests are
mandatory, not optional.

## ADR-014 — The calendar engine is ours {#adr-014}

**Decision.** Build the calendar's grid, overlap layout and drag interaction in-house. Take
recurrence (`rrule`) and timezone arithmetic (`date-fns-tz`) from libraries.

**Why.** What is genuinely hard about a calendar is RRULE, timezones and DST — solved problems
with well-tested libraries. What is _not_ hard, but _is_ specific, is the layout: an off-the-shelf
React calendar brings its own CSS and its own visual language, which is exactly what would stop
this product from looking native. Grid geometry and overlap resolution are pure functions with
unit tests.

## ADR-015 — Installers are not code-signed in 1.0.0 {#adr-015}

**Decision.** Ship unsigned MSI and NSIS installers; document the SmartScreen warning in the
README and `SECURITY.md`.

**Why.** A code-signing certificate is a recurring commercial cost that does not change the
security properties of the software, only the first-run experience. Deferring it is a budget
decision, taken openly, and reversible at any time.

## ADR-016 — End-to-end tests drive the real binary {#adr-016}

**Decision.** The end-to-end suite (`e2e/`, `npm run e2e`) launches the debug binary through
`tauri-driver` and the platform's WebDriver (`msedgedriver`, matched to the installed WebView2
runtime), on a workspace relocated by `TESSERA_DATA_DIR` to an empty temporary directory. The
client is a small W3C WebDriver implementation kept in the repository, not a framework.

**Why.** Unit tests prove rules; they cannot see the seams. The defects that survived green unit
suites in earlier slices all lived between two correct components — a cache in one window not
told about a write in another, a driver attaching to the wrong window, an index row not written
by one path. Only a test through the real host, the real page and the real file can find those,
and one did on its first run. The relocated workspace is what makes the suite safe to run on a
machine that has a real Tessera open, and it doubles as a migration test: every session starts
from an empty file.

**Cost accepted.** The suite needs a built binary and a driver that matches the WebView2
runtime, so it is not in the pull-request gate — `npm run gates` stays fast and hermetic. It
runs on a developer machine and from a manually triggered workflow. A global shortcut cannot be
pressed through WebDriver; that path is proved by Diagnostics reporting its registration and by
a person.

## ADR-017 — Backups are file copies; import replaces, never merges {#adr-017}

**Decision.** A backup is `VACUUM INTO` a timestamped file beside the workspace, taken on the
first start of each day and on request, kept in rotation. A restore closes the live connection,
copies the backup over the workspace file and reopens it through the same path start-up uses,
so pending migrations run. Export is the whole database read through `PRAGMA table_info`, one
JSON document; import replaces every table in one transaction, checked for referential
integrity before it commits, and rebuilds the search index. Before any restore or import a
safety backup is taken.

**Why.** `VACUUM INTO` gives a consistent, compacted copy of a live WAL database without
stopping it. Replacing the file is what a person means by "restore", and it is the one
strategy that also handles a backup from an older schema — the file comes back whole and the
migrations bring it forward. Reading the export through the schema means a migration cannot
leave a column out of it. Merging two histories of the same identifiers is synchronisation,
which this product has deliberately not built (README); a replace that asks first is honest.

**Cost accepted.** A restore interrupts the connection for the duration of a file copy. An
import from a different schema version is refused rather than migrated; the backup path
covers that case. Two backups in the same instant get a collision suffix rather than sharing a
name — the test that found the collision is `tests/restore.rs`.

## ADR-018 — Accessibility is gated, not reviewed {#adr-018}

**Decision.** Three gates hold the design system's §7: a unit test that parses the token file and
checks every text-on-surface pair in both themes against WCAG AA (`src/styles/tokens.test.ts`);
an axe-core audit run by the end-to-end suite on every screen in both themes, failing on any
serious or critical violation and reporting the rest; and a keyboard-only journey in the same
suite — tab order, focus rings, a dialog that holds Tab and gives focus back, and a block moved
on the calendar without a mouse. The keyboard route for moving time is its own pure module
(`src/domain/moveByKeys.ts`), so what a key means is tested without a window.

**Why.** A review remembers accessibility the week it is discussed. A gate remembers it on every
pull request. The first run of the contrast test found the light accent below AA on its own
tint and the strong stroke below the component minimum — both from the original palette, both
unnoticed by every screen review before it.

**Cost accepted.** axe-core is a development dependency injected into the page by the suite,
never shipped. The audit cannot judge how a screen reader _sounds_; that stays a person's job,
and is written down as such.
