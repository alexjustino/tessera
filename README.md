<div align="center">

# Tessera

**A professional workspace for tasks, projects and time — running entirely on your machine.**

Typed data core · Kanban · Block editor · Outlook-grade calendar · Native Windows reminders
No cloud. No account. No telemetry. Your data is a file you own.

[![CI](https://github.com/alexjustino/tessera/actions/workflows/ci.yml/badge.svg)](https://github.com/alexjustino/tessera/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D4.svg)](#requirements)

</div>

---

> **Status: pre-release.** Tessera is being built in public, one vertical slice at a time.
> See [the roadmap](#roadmap) for what ships in 1.0.0. There is no installer yet.

## Why

Four products own this space, and each one is right about exactly one thing.

**Microsoft To Do** nails frictionless capture and a native reminder — but it is a dumb list:
no fields, no board, no document, no calendar.
**Trello** has the best visual metaphor for flow — but that is _all_ it has; everything else
is a paid Power-Up.
**Notion** has the correct data model — a typed database with many views over it — but it is
slow, cloud-bound, and poor at answering "what do I do today?".
**Outlook** has the reference professional calendar — but tasks and time live in separate
worlds, with no board, no document, no properties.

Tessera is the intersection: **one typed data core, many views over it, a block document
inside every item, a real calendar beside it, and To Do's zero friction on top** — local,
instant, offline, and shaped like a native Windows 11 application.

The move none of the four make: **drag a task into the calendar and it becomes reserved time,
while still being the same task.**

## Feature comparison

|                               | MS To Do |   Trello   |  Notion  | Outlook |         **Tessera**          |
| ----------------------------- | :------: | :--------: | :------: | :-----: | :--------------------------: |
| Genuinely offline             | partial  |     ✗      |   poor   | partial |          **always**          |
| Open / filter                 |   fast   |   medium   |   slow   | medium  |    **instant (<100 ms)**     |
| Typed properties              |    ✗     |  limited   |    ✓     |    ✗    |         **✓ native**         |
| Many views over one base      |    ✗     | board only |    ✓     |    ✗    |            **✓**             |
| Block document in the item    |    ✗     |  markdown  |    ✓     |    ✗    |            **✓**             |
| Kanban board                  |    ✗     |     ✓      |    ✓     |    ✗    | **✓ swimlanes, WIP, covers** |
| Professional calendar         |    ✗     |     ✗      |   weak   |  **✓**  |  **✓ day/week/month/year**   |
| **Task becomes a time block** |    ✗     |     ✗      |    ✗     |  weak   |            **✓**             |
| Native toast + tray           |    ✓     |     ✗      |   weak   |    ✓    |      **✓ with actions**      |
| Global quick capture          |   weak   |     ✗      |    ✗     |    ✗    |     **✓ Ctrl+Alt+Space**     |
| Your data, your file          |    ✗     |     ✗      |    ✗     |    ✗    | **✓ SQLite, daily backups**  |
| Price                         | freemium |  freemium  | freemium | licence |    **free, open source**     |

## The name

In ancient Rome a _tessera_ was a small piece with two lives.

One was the **mosaic tile** — meaningless on its own, but locked together with the others it
forms the whole image. The other was the _**tessera militaris**_, the small tablet passed down
the ranks carrying the watchword and the order of the day: each soldier received one, knew what
to do, and passed it on. A third, the _tessera hospitalis_, was broken in two between friends —
each kept a half, and years later the halves fitting together proved the bond.

**A small piece that carries an order, and that only means something once it fits into the
whole.** That is a task inside a project, and a block inside a document.

## Design

Tessera is built to look like it belongs on Windows 11, not like a web page in a frame:
Mica window material, Acrylic flyouts, the **system accent colour** read from Windows and
followed live, rounded corners, a custom title bar, Segoe UI Variable, Fluent motion curves,
and a single icon set (Fluent UI System Icons). Light and dark themes follow the system.
Everything is reachable from the keyboard, and `prefers-reduced-motion` is honoured everywhere.

One known gap, stated rather than hidden: Snap Layouts — hovering the maximise button to pick
a window layout — needs native hit-testing that a custom title bar does not get for free.
Maximising works; the hover flyout does not appear yet.

## Privacy

Tessera makes **no network requests**. There is no account, no sync, no analytics, no crash
reporting, no update check. The Tauri content security policy blocks external origins, and the
application declares the minimum set of capabilities it needs — notably **not** shell execution.

Your data lives in a single SQLite file under your user profile. You can back it up, copy it,
or export it to JSON, Markdown and ICS at any time.

## Requirements

- Windows 11 (Windows 10 21H2+ works; Mica falls back to a solid surface)
- WebView2 runtime — already present on Windows 11

Building additionally needs Node.js 20+, Rust 1.80+, and the MSVC build tools.

## Getting started

```bash
git clone https://github.com/alexjustino/tessera.git
cd tessera
npm install
npm run tauri dev
```

Run the full validation battery exactly as CI does:

```bash
npm run gates
```

The end-to-end suite drives the real binary through WebDriver on a throwaway workspace. It needs
a debug build and a [Microsoft Edge WebDriver](https://developer.microsoft.com/microsoft-edge/tools/webdriver/)
matching your WebView2 runtime (`edge://version` shows it):

```bash
cargo install tauri-driver --locked
npm run e2e:build
$env:TESSERA_E2E_EDGEDRIVER = 'C:\path\to\msedgedriver.exe'
npm run e2e
```

## Roadmap

| Release   | Theme                         | Contents                                                                                                                                                                                                                |
| --------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0.0** | The workspace                 | typed core · List / Table / Board / Calendar · block editor · dates & recurrence · **calendar with time-blocking** · **Windows reminders** · quick capture · full-text search · Fluent design · backup & export · About |
| 1.1.0     | The project manager           | year view · timeline & Gantt · dependencies with critical path · time tracking · focus mode · reports · templates · daily capacity                                                                                      |
| 1.2.0     | The adopter                   | importers (Microsoft To Do, Trello, Notion, Todoist, ICS) · notes & wiki space · goals · print and PDF export · GTD review                                                                                              |
| 2.0       | Optional, only if it earns it | opt-in end-to-end-encrypted sync · macOS and Linux                                                                                                                                                                      |

Deliberately out of scope: real-time multi-user collaboration, AI, third-party cloud
integrations.

The full specification lives in [`docs/SPEC.md`](docs/SPEC.md); binding architecture decisions
in [`docs/architecture/ADR.md`](docs/architecture/ADR.md); the UI contract in
[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — it covers the branch model, Conventional
Commits, the architectural boundary rule, and the validation gates that must be green before
anything is merged. Security reports go through [`SECURITY.md`](SECURITY.md), never a public
issue.

## Licence

Licensed under the **Apache License 2.0** — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

Copyright 2026 Alex Justino.

_"Tessera" is a trademark of Alex Justino. The licence grants rights to the source code; it does
not grant permission to use the project name, logo or wordmark to endorse or promote derived
products (Apache-2.0 §6)._
