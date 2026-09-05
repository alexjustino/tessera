//! Dependency commands: read the graph, state an edge, take one back.

use tauri::State;

use crate::db::dependencies::{self, Dependency};
use crate::db::Db;
use crate::error::Result;

#[tauri::command]
pub fn dependencies_list(db: State<'_, Db>) -> Result<Vec<Dependency>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    dependencies::list(&conn)
}

/// `blocker` must finish before `blocked` may start. Refused if it would close
/// a loop, whatever the interface believed.
#[tauri::command]
pub fn dependency_link(db: State<'_, Db>, blocker_id: String, blocked_id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    dependencies::link(&conn, &blocker_id, &blocked_id)
}

#[tauri::command]
pub fn dependency_unlink(db: State<'_, Db>, blocker_id: String, blocked_id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    dependencies::unlink(&conn, &blocker_id, &blocked_id)
}
