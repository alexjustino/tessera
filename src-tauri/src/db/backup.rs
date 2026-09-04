//! Backups: a copy of the workspace file, taken safely, kept in rotation, and
//! put back on request.
//!
//! `VACUUM INTO` writes a consistent, compacted copy of a live database without
//! stopping it — the right primitive for a file that is open in WAL mode with a
//! scheduler reading it. Restoring is the plain thing a person would expect: the
//! live connection is closed, the backup file becomes the workspace file, and
//! the workspace is opened again through the same path every start-up takes,
//! pragmas and pending migrations included.
//!
//! A restore is destructive by definition, so it takes a safety backup first
//! and refuses a file that is not a Tessera workspace, or one from a newer
//! build than this one.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use super::migrations;
use crate::error::{Error, Result};

/// The folder beside the workspace file.
pub const FOLDER: &str = "backups";

const PREFIX: &str = "tessera-";
const SUFFIX: &str = ".sqlite3";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BackupInfo {
    pub path: String,
    pub file_name: String,
    /// When it was taken, from the file name (UTC).
    pub taken_at: String,
    pub bytes: u64,
}

pub fn folder(data_dir: &Path) -> PathBuf {
    data_dir.join(FOLDER)
}

fn file_name(at: DateTime<Utc>) -> String {
    format!("{PREFIX}{}{SUFFIX}", at.format("%Y%m%dT%H%M%S%3fZ"))
}

fn taken_at(name: &str) -> Option<String> {
    let stamp = name.strip_prefix(PREFIX)?.strip_suffix(SUFFIX)?;
    // A collision suffix (`-2`) is not part of the instant.
    let stamp = stamp.split('-').next()?;
    let parsed = chrono::NaiveDateTime::parse_from_str(stamp, "%Y%m%dT%H%M%S%3fZ")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(stamp, "%Y%m%dT%H%M%SZ"))
        .ok()?;
    Some(
        parsed
            .and_utc()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    )
}

/// A path in the folder that no existing backup occupies.
///
/// Two backups in the same millisecond happen — a restore takes a safety
/// backup an instant after the one it is asked to restore was listed — and
/// the second must never overwrite the first: that would restore the present.
fn free_path(dir: &Path, at: DateTime<Utc>) -> PathBuf {
    let base = file_name(at);
    let candidate = dir.join(&base);
    if !candidate.exists() {
        return candidate;
    }
    let stem = base.strip_suffix(SUFFIX).unwrap_or(&base);
    (2..)
        .map(|n| dir.join(format!("{stem}-{n}{SUFFIX}")))
        .find(|p| !p.exists())
        .expect("an unbounded range always yields")
}

/// Take a backup now. Returns what was written.
pub fn create(conn: &Connection, data_dir: &Path) -> Result<BackupInfo> {
    let dir = folder(data_dir);
    fs::create_dir_all(&dir).map_err(|_| Error::DataDir)?;

    let path = free_path(&dir, Utc::now());

    conn.execute("VACUUM INTO ?1", params![path.to_string_lossy().as_ref()])?;
    log::info!("backup written to {}", path.display());
    describe(&path).ok_or(Error::DataDir)
}

/// Every backup in the folder, newest first.
pub fn list(data_dir: &Path) -> Result<Vec<BackupInfo>> {
    let dir = folder(data_dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut found: Vec<BackupInfo> = entries
        .flatten()
        .filter_map(|entry| describe(&entry.path()))
        .collect();
    found.sort_by(|a, b| b.taken_at.cmp(&a.taken_at));
    Ok(found)
}

fn describe(path: &Path) -> Option<BackupInfo> {
    let name = path.file_name()?.to_str()?.to_string();
    let taken = taken_at(&name)?;
    let bytes = fs::metadata(path).ok()?.len();
    Some(BackupInfo {
        path: path.to_string_lossy().into_owned(),
        file_name: name,
        taken_at: taken,
        bytes,
    })
}

/// Delete the oldest backups beyond `keep`. Returns how many were removed.
pub fn rotate(data_dir: &Path, keep: u32) -> Result<usize> {
    let all = list(data_dir)?;
    let mut removed = 0;
    for stale in all.iter().skip(keep.max(1) as usize) {
        if fs::remove_file(&stale.path).is_ok() {
            removed += 1;
        }
    }
    if removed > 0 {
        log::info!("rotated {removed} old backup(s)");
    }
    Ok(removed)
}

/// Whether the daily backup is due: no backup yet, or the newest is from a
/// different UTC day than today.
pub fn due_today(data_dir: &Path) -> bool {
    match list(data_dir).ok().and_then(|all| all.into_iter().next()) {
        None => true,
        Some(newest) => !newest
            .taken_at
            .starts_with(&Utc::now().format("%Y-%m-%d").to_string()),
    }
}

/// What a file must be to be restored: a Tessera workspace at a schema this
/// build knows, and internally consistent. Returns its schema version.
pub fn inspect(path: &Path) -> Result<i64> {
    let source = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| Error::InvalidInput("that file could not be opened"))?;

    let version = migrations::current_version(&source);
    if version == 0 {
        return Err(Error::InvalidInput("that file is not a Tessera workspace"));
    }
    if version > migrations::target_version() {
        return Err(Error::InvalidInput(
            "that workspace comes from a newer version of Tessera",
        ));
    }
    let integrity: String = source
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| Error::InvalidInput("that file could not be read"))?;
    if integrity != "ok" {
        return Err(Error::InvalidInput("that file is damaged"));
    }
    Ok(version)
}

/// Replace the live workspace with the file at `path`.
///
/// A safety backup of the current state is written first, so a restore can
/// itself be undone. The live connection is closed, the file replaced, and the
/// workspace reopened the way start-up opens it — so pending migrations run,
/// since the file may predate this build. If the copy fails the old file is
/// still there, and the workspace is reopened on it.
pub fn restore(conn: &mut Connection, data_dir: &Path, path: &Path) -> Result<i64> {
    let version = inspect(path)?;
    create(conn, data_dir)?;

    let live = conn.path().map(PathBuf::from).ok_or(Error::DataDir)?;

    // Close the live connection: swap a placeholder in, close what came out.
    // Windows will not let a file be replaced while a handle is open on it.
    let previous = std::mem::replace(conn, Connection::open_in_memory()?);
    previous.close().map_err(|(_, error)| error)?;

    let copied = fs::copy(path, &live).map_err(|error| {
        log::error!("the backup could not be copied over the workspace: {error}");
        Error::InvalidInput("the backup could not be copied into place")
    });
    // Whatever the WAL held belonged to the old file.
    let _ = fs::remove_file(live.with_extension("sqlite3-wal"));
    let _ = fs::remove_file(live.with_extension("sqlite3-shm"));

    *conn = super::open_at(&live)?;
    copied?;
    log::info!(
        "workspace restored from {} (schema {version})",
        path.display()
    );
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_carry_the_instant_and_round_trip() {
        let at = DateTime::parse_from_rfc3339("2026-09-03T14:05:06Z")
            .unwrap()
            .with_timezone(&Utc);
        let name = file_name(at);
        assert_eq!(name, "tessera-20260903T140506000Z.sqlite3");
        assert_eq!(taken_at(&name).as_deref(), Some("2026-09-03T14:05:06.000Z"));
        // A collision suffix carries the same instant; the older second-only
        // names from the first builds still parse.
        assert_eq!(
            taken_at("tessera-20260903T140506000Z-2.sqlite3").as_deref(),
            Some("2026-09-03T14:05:06.000Z")
        );
        assert_eq!(
            taken_at("tessera-20260903T140506Z.sqlite3").as_deref(),
            Some("2026-09-03T14:05:06.000Z")
        );
        assert_eq!(taken_at("notes.txt"), None);
        assert_eq!(taken_at("tessera-garbage.sqlite3"), None);
    }

    #[test]
    fn two_backups_in_the_same_instant_never_share_a_file() {
        let dir = std::env::temp_dir().join(format!("tessera-free-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&dir).unwrap();
        let at = Utc::now();
        let first = free_path(&dir, at);
        fs::write(&first, b"x").unwrap();
        let second = free_path(&dir, at);
        assert_ne!(first, second);
        assert!(second.to_string_lossy().ends_with("-2.sqlite3"));
        fs::write(&second, b"y").unwrap();
        let third = free_path(&dir, at);
        assert!(third.to_string_lossy().ends_with("-3.sqlite3"));
        let _ = fs::remove_dir_all(&dir);
    }
}
