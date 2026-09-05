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

/// The largest text file an importer will read.
const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

/// A file another product exported, as text. The host checks size and
/// encoding; the domain layer decides whether it is a Todoist project, an
/// Outlook task folder, or nothing it knows.
#[tauri::command]
pub fn import_read_text(path: String) -> Result<String> {
    let path = Path::new(&path);
    let size = std::fs::metadata(path)
        .map_err(|_| crate::error::Error::InvalidInput("that file could not be read"))?
        .len();
    if size > MAX_TEXT_BYTES {
        return Err(crate::error::Error::InvalidInput(
            "that file is too large to be imported",
        ));
    }
    let bytes = std::fs::read(path)
        .map_err(|_| crate::error::Error::InvalidInput("that file could not be read"))?;
    // UTF-8 first; a Windows export in the machine's code page is read as
    // Latin-1 so that at least the ASCII survives, with the rest as it is.
    Ok(match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => error.into_bytes().iter().map(|&b| b as char).collect(),
    })
}
