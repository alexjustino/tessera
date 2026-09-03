//! Tessera — a professional local-first workspace for tasks, projects and time.
//!
//! # Layering
//!
//! This crate is deliberately thin. It owns three things and nothing else:
//! storage (SQLite, transactions, full-text search, migrations), the operating
//! system (window material, accent colour, notifications, tray), and the typed
//! command boundary. Business rules — filtering, recurrence, calendar layout,
//! timezone arithmetic, natural-language parsing — are pure TypeScript in
//! `src/domain/`, where they can be unit-tested without a window (ADR-003).
//!
//! # Changelog of this entry point
//!
//! - F0: database opened and migrated at startup, single-instance guard,
//!   rotating file log, accent ramp, notification probe.
//! - F8: reminder scheduler, tray, autostart; closing the window hides it.
//! - F9: quick-capture window on a global shortcut, one search over items and
//!   events, `TESSERA_DATA_DIR` to relocate the workspace (used by the
//!   end-to-end suite so it never touches a real one).

pub mod commands;
pub mod db;
pub mod error;
pub mod os;

use std::sync::Mutex;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // A second launch must focus the window that already exists rather than
    // opening a rival one — two processes would fight over the same database
    // and raise every reminder twice.
    #[cfg(all(desktop, not(any(target_os = "android", target_os = "ios"))))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    // Start with Windows, optionally. Off by default: a person opts in from
    // Diagnostics, and the product never registers itself behind their back.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ))
            .plugin(os::capture::plugin());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                // `Builder::new` arrives with a default target set. Adding to it
                // rather than replacing it writes every line twice — which is
                // exactly what happened, and was found by reading the log file
                // of a release build rather than by any test.
                .clear_targets()
                // Logs stay on this machine. There is no remote sink, by design.
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let connection = db::open(app.handle())?;
            let settings = db::settings::get(&connection).unwrap_or_default();
            app.manage(db::Db(Mutex::new(connection)));

            // The reminder loop and the tray. The tray is what keeps the process
            // alive when the window is closed, and the loop is why that matters.
            let scheduler = os::scheduler::start(app.handle().clone());
            app.manage(scheduler);
            os::tray::build(app.handle())?;
            // A failed shortcut registration is recorded, not fatal: the
            // capture line is still reachable from the tray and the palette.
            os::capture::install(app.handle(), &settings.quick_capture_shortcut)?;

            // Started by autostart: stay in the tray rather than opening a window
            // on top of whatever the person was about to do.
            if std::env::args().any(|arg| arg == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            log::info!(
                "workspace opened; Tessera {} ready",
                env!("CARGO_PKG_VERSION")
            );
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it. The process — and the reminder loop
            // — lives on in the tray; Quit in the tray menu is what ends it. A
            // person who set "remind me at nine" expects to be told at nine
            // whether or not the window is open.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::system_info,
            commands::system::accent_ramp,
            commands::reminders::probe_notification,
            commands::reminders::reminders_status,
            commands::reminders::reminders_pause,
            commands::reminders::reminders_resume,
            commands::reminders::reminder_snooze,
            commands::reminders::reminder_dismiss,
            commands::reminders::tray_refresh,
            commands::capture::capture_show,
            commands::capture::capture_hide,
            commands::capture::capture_status,
            commands::search::search,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_shortcuts,
            commands::items::item_capture,
            commands::items::collections_list,
            commands::items::items_list,
            commands::items::item_create,
            commands::items::item_set_completed,
            commands::items::item_rename,
            commands::items::item_move,
            commands::items::item_delete,
            commands::items::item_move_on_board,
            commands::items::item_set_schedule,
            commands::items::item_complete_occurrence,
            commands::properties::properties_list,
            commands::properties::property_create,
            commands::properties::property_update,
            commands::properties::property_delete,
            commands::properties::property_values_list,
            commands::properties::property_value_set,
            commands::views::views_list,
            commands::views::view_create,
            commands::views::view_update,
            commands::views::view_delete,
            commands::blocks::blocks_list,
            commands::blocks::blocks_apply,
            commands::calendar::calendars_list,
            commands::calendar::work_hours_list,
            commands::calendar::events_list,
            commands::calendar::event_exceptions_list,
            commands::calendar::event_create,
            commands::calendar::event_move,
            commands::calendar::event_rename,
            commands::calendar::event_delete,
            commands::calendar::event_set_exception,
            commands::calendar::time_block_create,
        ])
        .run(tauri::generate_context!())
        .expect("Tessera failed to start");
}
