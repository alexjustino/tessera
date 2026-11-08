//! The update check (ADR-062).
//!
//! One kind of outbound request in the whole application: a `GET` of the
//! release manifest GitHub publishes with each release. It is made here, by the
//! host, through the updater plugin; the web view's content security policy
//! still blocks every external origin. The setting is enforced here too, not
//! only in the interface: with it off, a check is refused before anything
//! leaves the machine.
//!
//! Nothing installs on its own. A check that finds a newer release keeps it
//! until the person presses Install, and the plugin verifies the installer
//! against the public key built into the application before it runs.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::db::{settings, Db};
use crate::error::{Error, Result};

/// How long a check waits for GitHub before it counts as unreachable.
const TIMEOUT: Duration = Duration::from_secs(20);

/// Where the test suite may point a check instead of GitHub (see [`test_endpoint`]).
pub const TEST_ENDPOINT_VAR: &str = "TESSERA_UPDATE_URL";

/// The update the last check found, held until the person installs it.
#[derive(Default)]
pub struct Pending(pub Mutex<Option<Update>>);

/// What the interface is told about a newer release.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Found {
    pub version: String,
    /// The release notes, as the release published them.
    pub notes: Option<String>,
}

/// An endpoint the test suite may use in place of GitHub: an `https` address
/// whose host is a loopback IP literal, and nothing else. The suite runs against
/// the release binary too, so the variable cannot be compiled out; it is kept
/// narrow instead. Certificates are validated as for GitHub, so nothing on this
/// machine can answer a check without a certificate Windows already trusts. The
/// suite's listener speaks no TLS at all: it only counts who knocks. And whatever
/// a check finds is still verified against the built-in key before it could run.
pub fn test_endpoint(raw: Option<&str>) -> Option<Url> {
    let url: Url = raw?.trim().parse().ok()?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "[::1]"));
    (url.scheme() == "https" && loopback).then_some(url)
}

/// Whether the person lets Tessera ask. Read from the workspace each time: the
/// host holds the switch, whatever the window does.
fn allowed(db: &Db) -> Result<bool> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    Ok(settings::get(&conn)?.update_check)
}

/// Forget an update found earlier, so one cannot be installed once the switch is off.
pub fn forget(pending: &Pending) {
    *pending.0.lock().expect("the update lock was poisoned") = None;
}

/// Ask whether a newer release exists. `None` means this is the newest.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    db: State<'_, Db>,
    pending: State<'_, Pending>,
) -> Result<Option<Found>> {
    if !allowed(&db)? {
        forget(&pending);
        return Err(Error::InvalidInput("checking for updates is turned off"));
    }

    let closing = app.clone();
    let mut builder = app
        .updater_builder()
        .timeout(TIMEOUT)
        // The installer ends this process the moment it starts. Before that,
        // wait for any write or backup in progress and fold the write-ahead log
        // into the database, then keep the lock so nothing starts after it.
        .on_before_exit(move || {
            let db = closing.state::<Db>();
            let conn = db.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Err(error) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
                log::warn!("the log was not folded in before the update: {error}");
            }
            log::info!("closing for the update");
            std::mem::forget(conn);
        });
    if let Some(url) = test_endpoint(std::env::var(TEST_ENDPOINT_VAR).ok().as_deref()) {
        log::info!("update check pointed at {url} by {TEST_ENDPOINT_VAR}");
        builder = builder.endpoints(vec![url]).map_err(|error| {
            log::warn!("update endpoint refused: {error}");
            Error::UpdateUnreachable
        })?;
    }
    let updater = builder.build().map_err(|error| {
        log::warn!("updater could not be built: {error}");
        Error::UpdateUnreachable
    })?;
    let update = updater.check().await.map_err(|error| {
        log::warn!("update check failed: {error}");
        Error::UpdateUnreachable
    })?;

    let found = update.as_ref().map(|update| Found {
        version: update.version.clone(),
        notes: update.body.clone(),
    });
    match &found {
        Some(found) => log::info!("update check: {} is available", found.version),
        None => log::info!("update check: this is the newest release"),
    }
    *pending.0.lock().expect("the update lock was poisoned") = update;
    Ok(found)
}

/// Download the update the last check found, verify it, and install it.
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    db: State<'_, Db>,
    pending: State<'_, Pending>,
) -> Result<()> {
    // The switch covers the download too, not only the check.
    if !allowed(&db)? {
        forget(&pending);
        return Err(Error::InvalidInput("checking for updates is turned off"));
    }
    let update = pending
        .0
        .lock()
        .expect("the update lock was poisoned")
        .take()
        .ok_or(Error::InvalidInput(
            "there is no update waiting; check again",
        ))?;
    log::info!("installing {}", update.version);
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| {
            log::error!("update could not be installed: {error}");
            Error::UpdateFailed
        })?;
    // On Windows the installer has already ended this process and starts the
    // new version itself; this is for a platform where the install returns.
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_test_endpoint_is_https_on_this_machine() {
        assert!(test_endpoint(Some("https://127.0.0.1:4919/latest.json")).is_some());
        assert!(test_endpoint(Some("https://[::1]:4919/latest.json")).is_some());
    }

    #[test]
    fn a_test_endpoint_refuses_anywhere_else() {
        assert_eq!(test_endpoint(None), None);
        assert_eq!(test_endpoint(Some("")), None);
        assert_eq!(test_endpoint(Some("not a url")), None);
        assert_eq!(
            test_endpoint(Some("http://127.0.0.1:4919/latest.json")),
            None
        );
        assert_eq!(test_endpoint(Some("https://example.com/latest.json")), None);
        assert_eq!(
            test_endpoint(Some("https://127.0.0.1.example.com/latest.json")),
            None
        );
        assert_eq!(test_endpoint(Some("file:///C:/latest.json")), None);
        // A name can be pointed anywhere; only the literal address is this machine.
        assert_eq!(
            test_endpoint(Some("https://localhost:4919/latest.json")),
            None
        );
    }

    #[test]
    fn checking_is_on_by_default_and_survives_an_older_document() {
        assert!(settings::Settings::default().update_check);
        let older: settings::Settings =
            serde_json::from_str(r#"{"theme":"dark","backups_keep":3}"#).unwrap();
        assert!(older.update_check);
    }
}
