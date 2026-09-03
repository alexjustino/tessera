//! The search command: one box over items and events.

use tauri::State;

use crate::db::search::{self, SearchHit};
use crate::db::Db;
use crate::error::Result;

/// `query` arrives shaped by the domain layer (`toFtsQuery`): tokens quoted,
/// the last one a prefix. `limit` is capped by the repository.
#[tauri::command]
pub fn search(db: State<'_, Db>, query: String, limit: Option<i64>) -> Result<Vec<SearchHit>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    search::search(&conn, &query, limit.unwrap_or(20))
}
