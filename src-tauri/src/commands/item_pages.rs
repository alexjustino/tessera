//! Commands for the pairs of a task and its notes.

use tauri::State;

use crate::db::item_pages::{self, ItemPage};
use crate::db::Db;
use crate::error::Result;

#[tauri::command]
pub fn item_pages_list(db: State<'_, Db>) -> Result<Vec<ItemPage>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    item_pages::list(&conn)
}

#[tauri::command]
pub fn item_page_link(db: State<'_, Db>, item_id: String, page_id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    item_pages::link(&conn, &item_id, &page_id)
}

#[tauri::command]
pub fn item_page_unlink(db: State<'_, Db>, item_id: String, page_id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    item_pages::unlink(&conn, &item_id, &page_id)
}
