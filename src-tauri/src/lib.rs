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
            app.manage(db::Db(Mutex::new(connection)));
            log::info!(
                "workspace opened; Tessera {} ready",
                env!("CARGO_PKG_VERSION")
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::system_info,
            commands::system::accent_ramp,
            commands::system::probe_notification,
            commands::items::collections_list,
            commands::items::items_list,
            commands::items::item_create,
            commands::items::item_set_completed,
            commands::items::item_rename,
            commands::items::item_move,
            commands::items::item_delete,
            commands::properties::properties_list,
            commands::properties::property_create,
            commands::properties::property_update,
            commands::properties::property_delete,
            commands::properties::property_values_list,
            commands::properties::property_value_set,
        ])
        .run(tauri::generate_context!())
        .expect("Tessera failed to start");
}
