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

/// One page beside a Notion table: the file's name without `.md`, and its text.
#[derive(serde::Serialize)]
pub struct PageFile {
    pub name: String,
    pub text: String,
}

/// The pages a Notion export keeps beside its table.
///
/// Unzipped, the export is `<Database> <hash>.csv` next to a folder of the
/// same name holding one `.md` per row. Given the table, this reads that
/// folder: no recursion, `.md` only, and a ceiling on how much is read, so a
/// folder that is not what it claims cannot fill memory.
#[tauri::command]
pub fn import_read_pages(path: String) -> Result<Vec<PageFile>> {
    let table = Path::new(&path);
    let folder = table.with_extension("");
    if !folder.is_dir() {
        return Ok(Vec::new());
    }

    const MAX_PAGES: usize = 5_000;
    const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

    let entries = std::fs::read_dir(&folder)
        .map_err(|_| crate::error::Error::InvalidInput("that folder could not be read"))?;
    let mut pages = Vec::new();
    let mut total = 0u64;

    for entry in entries.flatten() {
        if pages.len() >= MAX_PAGES || total >= MAX_TOTAL_BYTES {
            break;
        }
        let file = entry.path();
        if !file.is_file() || file.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        total += metadata.len();
        let Some(name) = file.file_stem().and_then(|n| n.to_str()) else {
            continue;
        };
        // A page that cannot be read is skipped, not fatal: the row keeps its
        // values and loses only its document, which the warning will say.
        if let Ok(text) = std::fs::read_to_string(&file) {
            pages.push(PageFile {
                name: name.to_string(),
                text,
            });
        }
    }

    pages.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(pages)
}
