//! Day-off commands (M3).

use tauri::State;

use crate::db::days_off::{self, DayOff};
use crate::db::Db;
use crate::error::Result;

#[tauri::command]
pub fn days_off_list(db: State<'_, Db>) -> Result<Vec<DayOff>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    days_off::list(&conn)
}

#[tauri::command]
pub fn day_off_set(db: State<'_, Db>, day: String, label: String) -> Result<DayOff> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    days_off::set(&conn, &day, &label)
}

#[tauri::command]
pub fn day_off_remove(db: State<'_, Db>, day: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    days_off::remove(&conn, &day)
}
