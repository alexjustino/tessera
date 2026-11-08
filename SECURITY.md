# Security Policy

## Supported versions

The latest release is supported. Fixes land on `main` and reach you as the next
release; there are no long-term support branches.

| Version         | Supported |
| --------------- | --------- |
| 1.0.x           | yes       |
| `main`          | yes       |
| earlier commits | no        |

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
and no listening network surface. Its one outbound request is the update check.

Security properties the project commits to:

- **One outbound request, which can be turned off** (ADR-062). Once a day, and when the person
  presses Check now, the host asks GitHub for the release manifest of `alexjustino/tessera`. The
  request carries no identifier and nothing from the workspace. With Settings → Updates off, the
  host refuses the check and the application makes no outbound request at all. The Tauri content
  security policy still blocks external origins in the web view. There is no sync, no telemetry,
  no analytics and no crash reporting.
- **What the check reveals.** The request carries no identifier and nothing from the workspace;
  its user agent names the updater library, not Tessera's version or the operating system. GitHub
  sees what any request shows: the address it comes from and the time. GitHub also publishes how
  many times each release file was downloaded, so the count of checks is public, roughly one per
  copy per day. A system proxy, if one is set, is used.
- **Updates are verified before they run.** An update is downloaded only when the person presses
  Install, and the plugin checks it against the Ed25519 public key built into the application,
  together with the version it was signed for, so an older signed installer cannot be passed off
  as a newer one. The private key exists only as a secret of the repository's release workflow,
  given to one step that signs two files; the build and every third-party action run without it.
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

The same attacker can replace a verified update in the moment between its check and its run: the
installer waits in your user's temporary folder. For the per-user setup that gains nothing they did
not have; for the MSI, Windows asks before it elevates, and names an unknown publisher because the
installers are not code-signed (ADR-015). Code signing is what would close that gap.

## Distribution integrity

Releases are built by GitHub Actions from a tagged commit and attached to the GitHub Release.
Verify what you install came from this repository's Releases page.

Installers are **not** code-signed today: Windows SmartScreen will warn on first run. That is
expected, and is a cost decision rather than a security posture — it is recorded in the
project's architecture decisions.
