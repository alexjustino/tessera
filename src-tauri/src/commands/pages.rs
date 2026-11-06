//! Page commands — the notes space.

use tauri::State;

use crate::db::pages::{self, Backlink, Page};
use crate::db::{sections, Db};
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

#[tauri::command]
pub fn sections_list(db: State<'_, Db>) -> Result<Vec<sections::Section>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    sections::list(&conn)
}

#[tauri::command]
pub fn section_create(
    db: State<'_, Db>,
    name: String,
    color: Option<String>,
    position: String,
) -> Result<sections::Section> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    sections::create(&conn, &name, color.as_deref(), &position)
}

#[tauri::command]
pub fn section_update(
    db: State<'_, Db>,
    id: String,
    name: String,
    color: Option<String>,
) -> Result<sections::Section> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    sections::update(&conn, &id, &name, color.as_deref())
}

#[tauri::command]
pub fn section_delete(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    sections::delete(&conn, &id)
}

#[tauri::command]
pub fn page_file(db: State<'_, Db>, id: String, section_id: Option<String>) -> Result<Page> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    sections::file_page(&conn, &id, section_id.as_deref())
}
