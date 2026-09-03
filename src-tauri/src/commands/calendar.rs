//! Calendar commands.

use tauri::State;

use crate::db::models::{Calendar, CalendarEvent, EventException, NewEvent, WorkHours};
use crate::db::{calendar, Db};
use crate::error::Result;

#[tauri::command]
pub fn calendars_list(db: State<'_, Db>) -> Result<Vec<Calendar>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::list_calendars(&conn)
}

#[tauri::command]
pub fn work_hours_list(db: State<'_, Db>) -> Result<Vec<WorkHours>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::list_work_hours(&conn)
}

#[tauri::command]
pub fn events_list(db: State<'_, Db>, from: String, to: String) -> Result<Vec<CalendarEvent>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::list_events(&conn, &from, &to)
}

#[tauri::command]
pub fn event_exceptions_list(db: State<'_, Db>) -> Result<Vec<EventException>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::list_exceptions(&conn)
}

#[tauri::command]
pub fn event_create(db: State<'_, Db>, event: NewEvent) -> Result<CalendarEvent> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::create_event(&conn, event)
}

#[tauri::command]
pub fn event_move(
    db: State<'_, Db>,
    id: String,
    starts_at_utc: String,
    ends_at_utc: String,
) -> Result<CalendarEvent> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::move_event(&conn, &id, &starts_at_utc, &ends_at_utc)
}

#[tauri::command]
pub fn event_rename(db: State<'_, Db>, id: String, title: String) -> Result<CalendarEvent> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::rename_event(&conn, &id, &title)
}

#[tauri::command]
pub fn event_delete(db: State<'_, Db>, id: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::delete_event(&conn, &id)
}

/// Cancel or move one occurrence of a series, leaving the rest alone.
#[tauri::command]
pub fn event_set_exception(
    db: State<'_, Db>,
    event_id: String,
    original_start_utc: String,
    kind: String,
    starts_at_utc: Option<String>,
    ends_at_utc: Option<String>,
) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::set_exception(
        &conn,
        &event_id,
        &original_start_utc,
        &kind,
        starts_at_utc.as_deref(),
        ends_at_utc.as_deref(),
    )
}

/// Reserve time for a task. The product's differentiator, in one transaction.
#[tauri::command]
pub fn time_block_create(
    db: State<'_, Db>,
    item_id: String,
    calendar_id: String,
    starts_at_utc: String,
    ends_at_utc: String,
    tz: String,
) -> Result<CalendarEvent> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    calendar::create_time_block(
        &mut conn,
        &item_id,
        &calendar_id,
        &starts_at_utc,
        &ends_at_utc,
        &tz,
    )
}

/// Items with time reserved anywhere, so the side panel can leave them out.
#[tauri::command]
pub fn time_blocked_items(db: State<'_, Db>) -> Result<Vec<String>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    calendar::time_blocked_item_ids(&conn)
}
