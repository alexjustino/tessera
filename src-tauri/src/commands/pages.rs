//! Page commands — the notes space.

use tauri::State;

use crate::db::pages::{self, Backlink, Page};
use crate::db::Db;
use crate::error::Result;

#[tauri::command]
pub fn pages_list(db: State<'_, Db>) -> Result<Vec<Page>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    pages::list(&conn)
}

#[tauri::command]
pub fn page_get(db: State<'_, Db>, id: String) -> Result<Page> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    pages::get(&conn, &id)
}

/// Make a page. `position` is the caller's: it knows the current order.
#[tauri::command]
pub fn page_create(db: State<'_, Db>, title: String, position: String) -> Result<Page> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    pages::create(&mut conn, &title, &position)
}

#[tauri::command]
pub fn page_rename(db: State<'_, Db>, id: String, title: String) -> Result<Page> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    pages::rename(&mut conn, &id, &title)
}

#[tauri::command]
pub fn page_delete(db: State<'_, Db>, id: String) -> Result<()> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    pages::delete(&mut conn, &id)
}

/// What points here — the other half of a link.
#[tauri::command]
pub fn page_backlinks(db: State<'_, Db>, id: String) -> Result<Vec<Backlink>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    pages::backlinks(&conn, &id)
}
