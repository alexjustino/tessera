//! Data commands: backups, restore, export and import.
//!
//! Paths for export and import come from the interface, which asked the person
//! with a native dialog; the host writes and reads the files itself. Backups
//! live beside the workspace and need no dialog.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::db::backup::{self, BackupInfo};
use crate::db::export::{self, Counts};
use crate::db::{settings, Db};
use crate::error::{Error, Result};

fn data_dir(app: &AppHandle) -> Result<PathBuf> {
    let file = crate::db::database_path(app)?;
    file.parent().map(Path::to_path_buf).ok_or(Error::DataDir)
}

/// After anything that replaced the workspace: every window refetches, the
/// tray recounts.
fn workspace_replaced(app: &AppHandle) {
    let _ = app.emit(crate::commands::items::WORKSPACE_CHANGED, ());
    crate::os::tray::refresh(app);
}

#[derive(Serialize)]
pub struct BackupsStatus {
    pub folder: String,
    pub backups: Vec<BackupInfo>,
    pub counts: Counts,
}

#[tauri::command]
pub fn backups_status(app: AppHandle, db: State<'_, Db>) -> Result<BackupsStatus> {
    let dir = data_dir(&app)?;
    let conn = db.0.lock().expect("the database lock was poisoned");
    Ok(BackupsStatus {
        folder: backup::folder(&dir).to_string_lossy().into_owned(),
        backups: backup::list(&dir)?,
        counts: export::counts(&conn)?,
    })
}

#[tauri::command]
pub fn backup_now(app: AppHandle, db: State<'_, Db>) -> Result<BackupInfo> {
    let dir = data_dir(&app)?;
    let conn = db.0.lock().expect("the database lock was poisoned");
    let written = backup::create(&conn, &dir)?;
    let keep = settings::get(&conn)?.backups_keep;
    backup::rotate(&dir, keep)?;
    Ok(written)
}

/// Restore a backup — one of the listed ones, or any file the person chose.
#[tauri::command]
pub fn backup_restore(app: AppHandle, db: State<'_, Db>, path: String) -> Result<Counts> {
    let dir = data_dir(&app)?;
    let counts = {
        let mut conn = db.0.lock().expect("the database lock was poisoned");
        backup::restore(&mut conn, &dir, Path::new(&path))?;
        export::counts(&conn)?
    };
    workspace_replaced(&app);
    Ok(counts)
}

/// Open the backups folder in Explorer.
#[tauri::command]
pub fn backups_reveal(app: AppHandle) -> Result<()> {
    let folder = backup::folder(&data_dir(&app)?);
    std::fs::create_dir_all(&folder).map_err(|_| Error::DataDir)?;
    app.opener()
        .open_path(folder.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|_| Error::DataDir)
}

#[tauri::command]
pub fn export_json(db: State<'_, Db>, path: String) -> Result<Counts> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    export::export_to_file(&conn, Path::new(&path))
}

#[tauri::command]
pub fn export_markdown(db: State<'_, Db>, path: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    let text = export::markdown(&conn)?;
    export::write_text(Path::new(&path), &text)
}

#[tauri::command]
pub fn export_ics(db: State<'_, Db>, path: String) -> Result<()> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    let text = export::ics(&conn)?;
    export::write_text(Path::new(&path), &text)
}

/// What an export file contains, before deciding to import it.
#[tauri::command]
pub fn import_inspect(path: String) -> Result<Counts> {
    let document = export::read_export(Path::new(&path))?;
    let rows = |table: &str| document.tables.get(table).map_or(0, |r| r.len() as i64);
    Ok(Counts {
        items: rows("item"),
        events: rows("event"),
        blocks: rows("block"),
    })
}

/// Replace the workspace with an export. A safety backup is taken first.
#[tauri::command]
pub fn import_json(app: AppHandle, db: State<'_, Db>, path: String) -> Result<Counts> {
    let dir = data_dir(&app)?;
    let document = export::read_export(Path::new(&path))?;
    let counts = {
        let mut conn = db.0.lock().expect("the database lock was poisoned");
        backup::create(&conn, &dir)?;
        export::import(&mut conn, &document)?
    };
    workspace_replaced(&app);
    Ok(counts)
}
