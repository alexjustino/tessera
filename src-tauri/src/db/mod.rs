//! Persistence: a thin repository over SQLite. No business logic lives here.
//!
//! The rule that keeps this file small: filtering, grouping, recurrence and
//! layout are pure TypeScript in `src/domain/` (ADR-004). Rust owns storage,
//! transactions, full-text search, migrations and the operating system.

pub mod backup;
pub mod blocks;
pub mod calendar;
pub mod dependencies;
pub mod export;
pub mod items;
pub mod migrations;
pub mod models;
pub mod properties;
pub mod reminders;
pub mod search;
pub mod settings;
pub mod templates;
pub mod time_entries;
pub mod views;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

/// The open database, held for the lifetime of the process.
pub struct Db(pub Mutex<Connection>);

/// The environment variable that relocates the workspace.
///
/// Set by the end-to-end suite so a test run never opens the person's real
/// workspace. It is read once, here, and reported by Diagnostics, so a relocated
/// workspace is never a silent one.
pub const DATA_DIR_ENV: &str = "TESSERA_DATA_DIR";

/// Resolve the workspace file: `%APPDATA%/io.github.alexjustino.tessera/tessera.sqlite3`,
/// or `$TESSERA_DATA_DIR/tessera.sqlite3` when the variable is set.
pub fn database_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = match std::env::var_os(DATA_DIR_ENV) {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => app.path().app_data_dir().map_err(|_| Error::DataDir)?,
    };
    std::fs::create_dir_all(&dir).map_err(|_| Error::DataDir)?;
    Ok(dir.join("tessera.sqlite3"))
}

/// Open the workspace, apply pending migrations, and return the connection.
pub fn open(app: &AppHandle) -> Result<Connection> {
    open_at(&database_path(app)?)
}

/// Open a workspace file the way start-up does. Also how a restore reopens it.
pub fn open_at(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;

    // WAL keeps readers from blocking the writer and survives a hard kill far
    // better than the rollback journal. NORMAL is the correct companion to WAL:
    // durable across application crash, and only at risk on OS power loss.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5_000)?;

    migrations::apply(&conn)?;
    Ok(conn)
}
