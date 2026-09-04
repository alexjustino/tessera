//! Time-tracking commands: start a clock, stop it, read what it recorded.

use tauri::State;

use crate::db::time_entries::{self, TimeEntry};
use crate::db::Db;
use crate::error::Result;

#[tauri::command]
pub fn time_entries_list(db: State<'_, Db>) -> Result<Vec<TimeEntry>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    time_entries::list(&conn)
}

/// The running entry, if a clock is going. Read at start-up: a timer left
/// running yesterday is still running now, because the row says so.
#[tauri::command]
pub fn time_running(db: State<'_, Db>) -> Result<Option<TimeEntry>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    time_entries::running(&conn)
}

/// Start timing a task, stopping whatever was running.
#[tauri::command]
pub fn time_start(db: State<'_, Db>, item_id: String) -> Result<TimeEntry> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    time_entries::start(&mut conn, &item_id)
}

#[tauri::command]
pub fn time_stop(db: State<'_, Db>) -> Result<Option<TimeEntry>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    time_entries::stop(&conn)
}

#[tauri::command]
pub fn time_entry_delete(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    time_entries::delete(&conn, &id)
}

/// Time the clock never saw, written by hand. Always already ended.
#[tauri::command]
pub fn time_entry_add(
    db: State<'_, Db>,
    item_id: String,
    started_at: String,
    ended_at: String,
) -> Result<TimeEntry> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    time_entries::add(&conn, &item_id, &started_at, &ended_at)
}

/// Correct an entry's start and end.
#[tauri::command]
pub fn time_entry_update(
    db: State<'_, Db>,
    id: String,
    started_at: String,
    ended_at: String,
) -> Result<TimeEntry> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    time_entries::update(&conn, &id, &started_at, &ended_at)
}
