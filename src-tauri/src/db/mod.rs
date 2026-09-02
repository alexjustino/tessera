//! Persistence: a thin repository over SQLite. No business logic lives here.
//!
//! The rule that keeps this file small: filtering, grouping, recurrence and
//! layout are pure TypeScript in `src/domain/` (ADR-004). Rust owns storage,
//! transactions, full-text search, migrations and the operating system.

pub mod items;
pub mod migrations;
pub mod models;
pub mod properties;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result};

/// The open database, held for the lifetime of the process.
pub struct Db(pub Mutex<Connection>);

/// Resolve the workspace file: `%APPDATA%/io.github.alexjustino.tessera/tessera.sqlite3`.
pub fn database_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|_| Error::DataDir)?;
    std::fs::create_dir_all(&dir).map_err(|_| Error::DataDir)?;
    Ok(dir.join("tessera.sqlite3"))
}

/// Open the workspace, apply pending migrations, and return the connection.
pub fn open(app: &AppHandle) -> Result<Connection> {
    let path = database_path(app)?;
    let conn = Connection::open(&path)?;

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
