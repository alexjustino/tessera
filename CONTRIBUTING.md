# Contributing to Tessera

Thank you for considering a contribution. This document is short on ceremony and precise
about the few rules that are not negotiable.

## Ground rules

1. **Green gates before anything.** `npm run gates` must pass locally, and CI must be green
   before a pull request is merged. There is no "I'll fix it after".
2. **One commit, one concern.** Stage per file. Never `git add .` blindly, never squash
   unrelated work together.
3. **Verified running, not just compiling.** If a change touches a screen, open the screen in
   the real application, in both light and dark theme, and drive it with the keyboard.
   A green type-check is not evidence that a UI works.
4. **Documentation is part of the delivery.** Behaviour, contract or procedure changed?
   The README, ADR, CHANGELOG, SPEC, DATA_MODEL or DESIGN_SYSTEM changes in the same pull
   request.

## The architectural boundary

This is the one rule that a reviewer will always check.

> `src/domain/` must never import from `src/data/`, `src/ui/`, `src/features/`,
> `react`, or `@tauri-apps/*`.

`domain/` is pure: entities, the query engine, recurrence expansion, calendar overlap layout,
timezone arithmetic, the natural-language parser, fractional indexing, report aggregation.
It performs no I/O and knows nothing about the UI or the host. That is what makes the hard
parts of this product unit-testable without mounting a component or starting a window.

The rule is enforced twice, on purpose: by ESLint `no-restricted-imports`, and by an
architecture test that fails CI. A rule without a gate is not a rule.

Business logic does not live in Rust either. `src-tauri/` is a thin repository plus the
operating-system surface: CRUD, transactions, FTS5, migrations, tray, notifications,
window effects.

## Branches

| Branch            | Meaning                                              |
| ----------------- | ---------------------------------------------------- |
| `main`            | always releasable, tagged; updated only at a release |
| `develop`         | integration branch; pull requests target this        |
| `feat/*`, `fix/*` | one slice or one fix                                 |
| `release/vX.Y`    | release stabilisation                                |

**Both `main` and `develop` are protected on GitHub**, and the protection says
what this document says: a pull request is required, the gates and the dependency
audit must be green before it can be merged, and neither branch can be
force-pushed or deleted. A rule with no gate is a rule that eventually gets
bypassed — including by the person who wrote it.

Tags follow SemVer: `vMAJOR.MINOR.PATCH`. See [`VERSIONING.md`](VERSIONING.md).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), imperative mood, 72 characters
or fewer in the subject, no trailing period.

```
<type>(<scope>): <description>
```

**Types** — `feat` `fix` `refactor` `docs` `test` `chore` `style` `perf` `build` `ci`

**Scopes** — the module's canonical token:
`items` `board` `blocks` `views` `calendar` `events` `reminders` `tray` `capture` `search`
`reports` `backup` `settings` `about` `db` `domain` `ui` `a11y` `ci` `docs` `deps`

```
feat(calendar): add work-week view with configurable first day
fix(reminders): recompute the schedule after resume from sleep
test(domain): cover DST transition in recurrence expansion
```

## Gates

```bash
npm run gates
```

runs, and all of them must pass:

| Gate                       | What it protects                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `cargo fmt --check`        | Rust formatting                                                                      |
| `cargo clippy -D warnings` | Rust correctness and idiom                                                           |
| `cargo test`               | repository, migrations, OS layer                                                     |
| `tsc --noEmit`             | type correctness                                                                     |
| `eslint`                   | **`react-hooks/rules-of-hooks` is an error**, plus the boundary rule                 |
| `prettier --check`         | formatting                                                                           |
| `vitest`                   | domain rules, including negative cases                                               |
| `npm run e2e` (separate)   | the real binary through WebDriver — needs a debug build and `msedgedriver` (ADR-016) |

> A hook placed after an early return type-checks cleanly and crashes the screen at runtime.
> That is why the lint gate is mandatory and not advisory.

## Tests

New rules arrive with tests, **including the negative case**. For anything touching time, the
following are not optional: month boundaries, leap years, **daylight-saving transitions**,
events crossing midnight, a cancelled occurrence inside a series, an unbounded recurrence, and
the timezone changing while the application is open.

Coverage target for `src/domain/`: **90%**.

## Pull requests

Target `develop`. One slice per pull request. The body uses the template and states what was
verified, on which screen, and in which theme.

## Reporting security issues

Do not open a public issue. Follow [`SECURITY.md`](SECURITY.md).

## Licence of contributions

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), consistent with the rest of the project.
