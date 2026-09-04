//! Template commands: keep a shape of work, and make tasks from it.

use tauri::State;

use crate::db::models::Item;
use crate::db::templates::{self, PlannedEdge, PlannedTask, Template};
use crate::db::Db;
use crate::error::Result;

#[tauri::command]
pub fn templates_list(db: State<'_, Db>) -> Result<Vec<Template>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    templates::list(&conn)
}

#[tauri::command]
pub fn template_create(db: State<'_, Db>, name: String, body_json: String) -> Result<Template> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    templates::create(&conn, &name, &body_json)
}

#[tauri::command]
pub fn template_delete(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    templates::delete(&conn, &id)
}

/// Every task and every link, or none: one transaction for one button.
#[tauri::command]
pub fn template_apply(
    db: State<'_, Db>,
    collection_id: String,
    tasks: Vec<PlannedTask>,
    edges: Vec<PlannedEdge>,
) -> Result<Vec<Item>> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    templates::apply(&mut conn, &collection_id, &tasks, &edges)
}
