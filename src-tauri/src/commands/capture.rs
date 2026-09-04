//! Quick-capture commands: show and hide the capture line, and say whether
//! its shortcut is live.

use tauri::AppHandle;

use crate::os::capture::{self, CaptureStatus};

#[tauri::command]
pub fn capture_show(app: AppHandle) {
    capture::show(&app);
}

#[tauri::command]
pub fn capture_hide(app: AppHandle) {
    capture::hide(&app);
}

#[tauri::command]
pub fn capture_status(app: AppHandle) -> CaptureStatus {
    capture::status(&app)
}
