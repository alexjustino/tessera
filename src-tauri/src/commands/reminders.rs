//! Reminder and notification commands.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::reminders::{self, PendingReminder};
use crate::db::Db;
use crate::error::Result;
use crate::os::scheduler::Scheduler;
use crate::os::{notify, tray};

/// What the Diagnostics screen shows about the alert pipeline.
#[derive(Serialize)]
pub struct ReminderStatus {
    pub pending: Vec<PendingReminder>,
    /// ISO-8601, or null when reminders are not paused.
    pub paused_until: Option<String>,
}

#[tauri::command]
pub fn reminders_status(
    db: State<'_, Db>,
    scheduler: State<'_, Scheduler>,
) -> Result<ReminderStatus> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    Ok(ReminderStatus {
        pending: reminders::pending(&conn)?,
        paused_until: scheduler.paused_until().map(|at| at.to_rfc3339()),
    })
}

#[tauri::command]
pub fn reminders_pause(scheduler: State<'_, Scheduler>, minutes: i64) -> Result<()> {
    let until: DateTime<Utc> = Utc::now() + Duration::minutes(minutes.max(1));
    scheduler.pause_until(until);
    log::info!("reminders paused until {until}");
    Ok(())
}

#[tauri::command]
pub fn reminders_resume(scheduler: State<'_, Scheduler>) -> Result<()> {
    scheduler.resume();
    Ok(())
}

#[tauri::command]
pub fn reminder_snooze(
    db: State<'_, Db>,
    scheduler: State<'_, Scheduler>,
    id: String,
    minutes: i64,
) -> Result<()> {
    let until = (Utc::now() + Duration::minutes(minutes.max(1))).to_rfc3339();
    {
        let conn = db.0.lock().expect("the database lock was poisoned");
        reminders::snooze(&conn, &id, &until)?;
    }
    scheduler.nudge();
    Ok(())
}

#[tauri::command]
pub fn reminder_dismiss(
    db: State<'_, Db>,
    scheduler: State<'_, Scheduler>,
    id: String,
) -> Result<()> {
    {
        let conn = db.0.lock().expect("the database lock was poisoned");
        reminders::dismiss(&conn, &id)?;
    }
    scheduler.nudge();
    Ok(())
}

/// Raise a reminder-shaped toast and report what actually happened.
///
/// The foundation slice's probe, kept: it is still the only honest way to see
/// whether Windows accepts this build's identity.
#[tauri::command]
pub fn probe_notification(app: AppHandle) -> notify::ToastOutcome {
    let handle = app.clone();
    notify::send(
        "Tessera",
        "Reminder pipeline probe — this toast carries action buttons.",
        &notify::reminder_actions(),
        move |argument| {
            log::info!("probe toast activated with {argument:?}");
            crate::os::scheduler::show_window(&handle);
        },
    )
}

/// Ask the tray to recount after something changed.
#[tauri::command]
pub fn tray_refresh(app: AppHandle) {
    tray::refresh(&app);
}
