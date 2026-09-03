//! The tray icon: the product's presence when its window is not.
//!
//! Reminders are the reason the tray exists. A person who set "remind me at
//! nine" expects to be told at nine whether or not the window is open, so the
//! window closing must not be the process ending. Close hides; the tray keeps
//! the scheduler alive; Quit in the menu is what actually stops it.
//!
//! The tooltip carries the count of what is overdue or due today. Windows does
//! not give an ordinary application a badge on its tray icon, so the tooltip is
//! where the number lives — visible on hover, honest, and not a fake overlay.

use chrono::{Duration, Utc};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::db::reminders;
use crate::db::Db;
use crate::os::scheduler::{show_window, Scheduler};

pub const TRAY_ID: &str = "main";

const OPEN: &str = "open";
const TODAY: &str = "today";
const CAPTURE: &str = "capture";
const PAUSE_HOUR: &str = "pause-hour";
const RESUME: &str = "resume";
const QUIT: &str = "quit";

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, OPEN, "Open Tessera", true, None::<&str>)?;
    let today = MenuItem::with_id(app, TODAY, "Today", true, None::<&str>)?;
    let capture = MenuItem::with_id(
        app,
        CAPTURE,
        format!("Quick capture\t{}", crate::os::capture::SHORTCUT_LABEL),
        true,
        None::<&str>,
    )?;
    let pause = MenuItem::with_id(
        app,
        PAUSE_HOUR,
        "Pause reminders for 1 hour",
        true,
        None::<&str>,
    )?;
    let resume = MenuItem::with_id(app, RESUME, "Resume reminders", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open,
            &today,
            &capture,
            &PredefinedMenuItem::separator(app)?,
            &pause,
            &resume,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("the bundle declares an icon");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(tooltip(app))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN | TODAY => {
                show_window(app);
                // The window navigates itself; the tray only asks.
                let _ = tauri::Emitter::emit(app, "tray:navigate", event.id().as_ref());
            }
            CAPTURE => crate::os::capture::show(app),
            PAUSE_HOUR => {
                if let Some(scheduler) = app.try_state::<Scheduler>() {
                    scheduler.pause_until(Utc::now() + Duration::hours(1));
                    log::info!("reminders paused for an hour from the tray");
                }
            }
            RESUME => {
                if let Some(scheduler) = app.try_state::<Scheduler>() {
                    scheduler.resume();
                }
            }
            QUIT => {
                log::info!("quit from the tray");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // A left click is "show me", the same as Open.
            if let TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Refresh the tooltip after anything that could change the count.
pub fn refresh(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip(app)));
    }
}

/// "Tessera — 3 due today" or just "Tessera".
fn tooltip(app: &AppHandle) -> String {
    // "Due today" is everything due before the end of today. The end of today is
    // a wall-clock question the host answers approximately: the next UTC
    // midnight plus a day is generous, and the tooltip is a hint, not a ledger.
    let end_of_today = (Utc::now() + Duration::days(1)).to_rfc3339();
    let count = app.try_state::<Db>().and_then(|db| {
        let conn = db.0.lock().ok()?;
        reminders::count_open_due_before(&conn, &end_of_today).ok()
    });

    match count {
        Some(0) | None => "Tessera".to_string(),
        Some(1) => "Tessera — 1 due today".to_string(),
        Some(n) => format!("Tessera — {n} due today"),
    }
}
