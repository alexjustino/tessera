//! The import door: read a file, apply a decided plan, list and undo imports.

use std::path::Path;

use tauri::{AppHandle, Emitter, State};

use crate::commands::items::WORKSPACE_CHANGED;
use crate::db::export;
use crate::db::importing::{self, Batch, Plan};
use crate::db::Db;
use crate::error::Result;

/// A Tessera export, as the JSON it is. The domain layer turns it into a plan;
/// the host only checks it is one of ours and not absurdly large.
#[tauri::command]
pub fn import_read_export(path: String) -> Result<serde_json::Value> {
    let document = export::read_export_lenient(Path::new(&path))?;
    serde_json::to_value(document)
        .map_err(|_| crate::error::Error::InvalidInput("that file could not be read"))
}

/// Rows of several kinds arrive at once; every window is told to read afresh,
/// the way the replacing import and a restore already do.
#[tauri::command]
pub fn import_apply(app: AppHandle, db: State<'_, Db>, plan: Plan) -> Result<Batch> {
    let batch = {
        let mut conn = db.0.lock().expect("the database lock was poisoned");
        importing::apply(&mut conn, &plan)?
    };
    let _ = app.emit(WORKSPACE_CHANGED, ());
    Ok(batch)
}

#[tauri::command]
pub fn imports_list(db: State<'_, Db>) -> Result<Vec<Batch>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    importing::list(&conn)
}

#[tauri::command]
pub fn import_undo(app: AppHandle, db: State<'_, Db>, id: String) -> Result<Batch> {
    let batch = {
        let mut conn = db.0.lock().expect("the database lock was poisoned");
        importing::undo(&mut conn, &id)?
    };
    let _ = app.emit(WORKSPACE_CHANGED, ());
    Ok(batch)
}
