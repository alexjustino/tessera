# Security Policy

## Supported versions

Tessera is pre-release. Until 1.0.0, only the tip of `main` is supported.

| Version      | Supported |
| ------------ | --------- |
| `main`       | yes       |
| pre-1.0 tags | no        |

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. That channel is private to the maintainer.

Please include what you can: affected version or commit, environment, reproduction steps,
observed impact, and any proof of concept. You will get an acknowledgement within a few days
and an assessment of severity and remediation once the report is reproduced.

Please do not disclose publicly until a fix is released, or until we agree a date together.

## Threat model

Tessera is a **single-user, local-first desktop application**. It has no server, no account,
and no network surface.

Security properties the project commits to:

- **No network access.** The application makes no outbound requests. The Tauri content
  security policy blocks external origins. There is no sync, no telemetry, no analytics,
  no crash reporting and no update check.
- **Minimum capabilities.** Tauri 2 capabilities are declared explicitly, one by one.
  Shell execution is not granted. Filesystem access is scoped to the application data
  directory.
- **No secrets at rest.** The application stores no credentials and no tokens.
- **Untrusted input is data, never instruction.** Imported files from other products
  (Microsoft To Do, Trello, Notion, ICS) are parsed by never-throwing parsers with size
  limits; nothing in an imported file is executed and no external reference in one is
  followed.
- **Diagnostic bundles are redacted.** The exported diagnostic archive contains logs, schema
  and counts. It never contains the content of your tasks, notes or events.

Out of the threat model, and stated plainly: an attacker with write access to your Windows
user account, or with physical access to an unlocked machine, can read the database file.
The database is not encrypted at rest in 1.0.0. If that matters for your data, use full-disk
encryption (BitLocker).

## Distribution integrity

Releases are built by GitHub Actions from a tagged commit and attached to the GitHub Release.
Verify what you install came from this repository's Releases page.

Installers are **not** code-signed today: Windows SmartScreen will warn on first run. That is
expected, and is a cost decision rather than a security posture — it is recorded in the
project's architecture decisions.
