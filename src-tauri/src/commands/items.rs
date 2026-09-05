//! Item commands: the typed boundary for the first vertical slice.
//!
//! Each one validates nothing beyond what the repository already checks,
//! delegates, and returns. Ordering keys arrive from the domain layer rather
//! than being computed here, so the algorithm stays in one tested place.

use tauri::State;

use crate::db::models::{CaptureRequest, Collection, Item, ItemPlan, ItemSchedule, NewItem};
use crate::db::{items, Db};
use crate::error::Result;

/// Emitted to every window after a write made outside the main window — the
/// quick-capture window has its own page and its own cache, and the workspace
/// behind it must not look stale to the person who then opens the main one.
pub const WORKSPACE_CHANGED: &str = "workspace:changed";

/// Quick capture: one line, already parsed by the domain layer, written whole.
#[tauri::command]
pub fn item_capture(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    request: CaptureRequest,
) -> Result<Item> {
    let item = {
        let mut conn = db.0.lock().expect("the database lock was poisoned");
        items::capture_item(&mut conn, request)?
    };
    let _ = tauri::Emitter::emit(&app, WORKSPACE_CHANGED, ());
    Ok(item)
}

#[tauri::command]
pub fn collections_list(db: State<'_, Db>) -> Result<Vec<Collection>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    items::list_collections(&conn)
}

#[tauri::command]
pub fn items_list(
    db: State<'_, Db>,
    collection_id: Option<String>,
    include_completed: bool,
) -> Result<Vec<Item>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    items::list_items(&conn, collection_id.as_deref(), include_completed)
}

#[tauri::command]
pub fn item_create(db: State<'_, Db>, item: NewItem) -> Result<Item> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    items::create_item(&mut conn, item)
}

#[tauri::command]
pub fn item_set_completed(db: State<'_, Db>, id: String, completed: bool) -> Result<Item> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    items::set_completed(&conn, &id, completed)
}

#[tauri::command]
pub fn item_rename(db: State<'_, Db>, id: String, title: String) -> Result<Item> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    items::rename_item(&mut conn, &id, &title)
}

#[tauri::command]
pub fn item_move(
    db: State<'_, Db>,
    id: String,
    position: String,
    collection_id: Option<String>,
) -> Result<Item> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    items::move_item(&conn, &id, &position, collection_id.as_deref())
}

#[tauri::command]
pub fn item_delete(db: State<'_, Db>, id: String) -> Result<()> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    items::delete_item(&mut conn, &id)
}

/// Move a card on a board: position and grouping field, in one transaction.
#[tauri::command]
pub fn item_move_on_board(
    db: State<'_, Db>,
    id: String,
    position: String,
    property_id: Option<String>,
    value: serde_json::Value,
) -> Result<Item> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    items::move_on_board(&mut conn, &id, &position, property_id.as_deref(), &value)
}

/// Set an item's dates and repetition.
#[tauri::command]
pub fn item_set_schedule(db: State<'_, Db>, id: String, schedule: ItemSchedule) -> Result<Item> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    items::set_schedule(&conn, &id, schedule)
}

/// Complete one occurrence of a repeating item, moving it to its next date.
#[tauri::command]
pub fn item_complete_occurrence(
    db: State<'_, Db>,
    id: String,
    next_due_at: Option<String>,
) -> Result<Item> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    items::complete_occurrence(&mut conn, &id, next_due_at.as_deref())
}

/// How long this task takes, and whether it takes any time at all.
#[tauri::command]
pub fn item_set_plan(db: State<'_, Db>, id: String, plan: ItemPlan) -> Result<Item> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    items::set_plan(&conn, &id, plan)
}
