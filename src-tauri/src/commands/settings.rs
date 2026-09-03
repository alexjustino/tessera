//! Settings commands: read, replace, and re-bind what the host must act on.

use tauri::{AppHandle, State};

use crate::db::settings::{self, Settings};
use crate::db::Db;
use crate::error::Result;

#[tauri::command]
pub fn settings_get(db: State<'_, Db>) -> Result<Settings> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    settings::get(&conn)
}

/// Replace the settings. The quick-capture shortcut is re-registered at once,
/// so the person sees in Diagnostics whether the new combination took.
#[tauri::command]
pub fn settings_set(app: AppHandle, db: State<'_, Db>, settings: Settings) -> Result<Settings> {
    let stored = {
        let conn = db.0.lock().expect("the database lock was poisoned");
        settings::set(&conn, &settings)?
    };
    crate::os::capture::rebind(&app, &stored.quick_capture_shortcut);
    Ok(stored)
}

/// The closed list of shortcuts a person may choose from.
#[tauri::command]
pub fn settings_shortcuts() -> Vec<&'static str> {
    settings::SHORTCUTS.to_vec()
}
