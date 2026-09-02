//! View commands.

use serde_json::Value;
use tauri::State;

use crate::db::models::{NewView, View};
use crate::db::{views, Db};
use crate::error::Result;

#[tauri::command]
pub fn views_list(db: State<'_, Db>, collection_id: Option<String>) -> Result<Vec<View>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    views::list_views(&conn, collection_id.as_deref())
}

#[tauri::command]
pub fn view_create(db: State<'_, Db>, view: NewView) -> Result<View> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    views::create_view(&conn, view)
}

#[tauri::command]
pub fn view_update(
    db: State<'_, Db>,
    id: String,
    name: String,
    kind: String,
    config: Value,
) -> Result<View> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    views::update_view(&conn, &id, &name, &kind, &config)
}

#[tauri::command]
pub fn view_delete(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    views::delete_view(&conn, &id)
}
