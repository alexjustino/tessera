//! Goal commands.

use tauri::State;

use crate::db::goals::{self, Goal, GoalLink, GoalPatch};
use crate::db::Db;
use crate::error::Result;

#[tauri::command]
pub fn goals_list(db: State<'_, Db>) -> Result<Vec<Goal>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    goals::list(&conn)
}

#[tauri::command]
pub fn goal_create(
    db: State<'_, Db>,
    name: String,
    measure: String,
    target: i64,
    due_day: Option<String>,
    position: String,
) -> Result<Goal> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    goals::create(
        &conn,
        &name,
        &measure,
        target,
        due_day.as_deref(),
        &position,
    )
}

#[tauri::command]
pub fn goal_update(db: State<'_, Db>, id: String, patch: GoalPatch) -> Result<Goal> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    goals::update(&conn, &id, patch)
}

#[tauri::command]
pub fn goal_delete(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    goals::delete(&conn, &id)
}

/// Every membership at once; the client joins them to the tasks it has.
#[tauri::command]
pub fn goal_links_list(db: State<'_, Db>) -> Result<Vec<GoalLink>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    goals::links(&conn)
}

#[tauri::command]
pub fn goal_link(db: State<'_, Db>, goal_id: String, item_id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    goals::link(&conn, &goal_id, &item_id)
}

#[tauri::command]
pub fn goal_unlink(db: State<'_, Db>, goal_id: String, item_id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    goals::unlink(&conn, &goal_id, &item_id)
}
