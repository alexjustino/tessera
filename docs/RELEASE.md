# Releasing Tessera

The flow is in [`VERSIONING.md`](../VERSIONING.md); this is the checklist that
runs it. Every step is a command or a thing a person looks at, in order, and
nothing here is optional — a release that skipped a step is a release nobody
can reason about afterwards.

## Before the tag

1. **The slice branches are merged** into `develop` and CI is green on it.
2. **Bump the version** in `src-tauri/tauri.conf.json`. Mirror it into
   `package.json` and `src-tauri/Cargo.toml`, then prove they agree:

   ```bash
   npm run check:version
   ```

3. **Close the changelog.** Move `[Unreleased]` into `[X.Y.Z] — YYYY-MM-DD`.
   Write it for somebody who has never seen the product, not as a diff against
   the last commit. Note any migration the release adds, as
   `VERSIONING.md` requires.
4. **Run the whole battery**, which builds the installers and checks them:

   ```bash
   npm run release:check
   ```

   That is `npm run gates`, then `tauri build`, then `check:bundle` — which
   fails if an installer is over 20 MB, if `dist/` carries source, or if the
   binary was not stripped.

5. **Run the end-to-end suite against the release binary**, not the debug one.
   This is the closest thing to a clean machine that a developer machine can
   offer: a workspace created from empty, migrated from nothing, driven through
   the real product.

   ```bash
   $env:TESSERA_E2E_APP = "$PWD\src-tauri\target\release\tessera.exe"
   $env:TESSERA_E2E_EDGEDRIVER = "C:\path\to\msedgedriver.exe"
   npm run e2e:only
   ```

   This step runs on a developer machine: WebDriver does not start on a hosted
   runner (ADR-016). `screen-reader` reads system focus, which needs the foreground.
   If it fails naming a control of another program, run that file again by itself;
   if it names anything of Tessera's, that is a defect.

   The **Install proof** workflow runs by itself on a push to `release/**`: a fresh
   machine, the published previous version, this build on top with nothing lost, the
   interface appearing, uninstall keeping the data, and the MSI. It must be green. It
   is Windows Server with tools on it and WebView2 present, so it does not replace
   the next step.

6. **Install the MSI and use it.** The suite cannot press a global shortcut,
   cannot see a toast beside the clock, and cannot judge how a screen reader
   sounds. A person does:
   - install, launch, and add a task from the line;
   - set a reminder a minute out, close the window, and wait for the toast —
     Complete, Snooze and Open all do what they say;
   - press the quick-capture shortcut over another program;
   - Settings → Export JSON, then Import it back;
   - back up, change something, restore, and check the change is gone.

## The tag

7. **Open a pull request from `release/vX.Y` into `main`.** `main` is always
   releasable; it receives releases and nothing else.
8. **Merge it, then tag `main`:**

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

9. The **Release workflow** runs on the tag. It stops at once when the signing
   secret is missing, when the updater public key in `tauri.conf.json` is still
   the placeholder, or when the tag is not the version (ADR-062). Then: gates,
   one build, the bundle check, the signing of the two installers in a step of
   its own, a check of both signatures against the public key the copies carry
   (`scripts/verify-update-signature.mjs`), `latest.json` written from them, and
   a **draft** GitHub Release with the installers, their `.sig` files and
   `latest.json`. It is a draft on purpose — somebody reads the notes before the
   world does. Installed copies look for `releases/latest/download/latest.json`,
   which a draft does not serve: nobody is offered the release until it is
   published. The notes the update bar shows are the version's section of
   `CHANGELOG.md`.

10. **Edit the draft release notes** from the changelog, then publish.
11. **Merge `main` back into `develop`** so the release commits are not stranded.

## The updater key

Every installed copy checks an update against the Ed25519 public key in
`src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The owner made the pair
once, with `npx tauri signer generate`, and holds the private key outside the
repository, with a copy kept somewhere safe. The release workflow reads it from
two repository secrets, `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, in one step that signs two files and runs
nothing else: the build, the install of dependencies and every third-party
action run without it, and the actions are pinned by commit. A local
`release:check` never needs the key.

If the private key is lost or exposed, make a new pair, put the new public key
in `tauri.conf.json`, replace both secrets, and say in the release notes that
copies older than that release are updated by hand, once: they cannot verify a
release signed with the new key.

## After

- The installers are unsigned; SmartScreen warns on first run. The README and
  the release notes both say so, and neither pretends otherwise.
- If a fix is needed before the next minor, branch `release/vX.Y` from the tag,
  fix, and cut `vX.Y.Z+1` the same way.
