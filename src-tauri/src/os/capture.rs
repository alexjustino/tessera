//! Quick capture: a global shortcut and the small window it summons.
//!
//! The promise of F9 is a task in under five seconds without opening the
//! application. That needs two things only the host can provide: a key
//! combination that works while another program has focus, and a window that
//! appears over that program, takes one line, and gets out of the way.
//!
//! The shortcut may fail to register — another program may own it. That is
//! not hidden: the outcome is kept and reported to Diagnostics and to the
//! palette, so the person learns the key does nothing *from the product*, not
//! by pressing it and wondering.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// The window label. The interface branches on it to render the capture line
/// instead of the workspace.
pub const WINDOW: &str = "capture";

/// The default combination, the one the specification names. Free on a stock
/// Windows install — `Win+` combinations are the operating system's, and
/// `Alt+Space` alone is the window menu. Settings offers a closed list of
/// alternatives.
pub const SHORTCUT_LABEL: &str = "Ctrl+Alt+Space";

/// Emitted to the capture window each time it is shown, so the line is empty
/// and focused whatever it held before.
pub const SHOWN_EVENT: &str = "capture:shown";

/// What happened when the shortcut was registered. Read by Diagnostics.
#[derive(Debug, Clone, Serialize)]
pub struct CaptureStatus {
    pub shortcut: &'static str,
    pub registered: bool,
    /// Why not, in a sentence, when `registered` is false.
    pub problem: Option<String>,
}

/// The registration outcome, kept for the lifetime of the process.
pub struct CaptureState(pub Mutex<CaptureStatus>);

/// The combination a settings label names. The list is closed on both sides
/// (`db::settings::SHORTCUTS`); a label outside it falls back to the default.
pub fn parse_shortcut(label: &str) -> Shortcut {
    match label {
        "Ctrl+Alt+T" => Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyT),
        "Ctrl+Shift+Space" => {
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
        }
        "Ctrl+Alt+N" => Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN),
        _ => Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space),
    }
}

fn known_label(label: &str) -> &'static str {
    crate::db::settings::SHORTCUTS
        .iter()
        .copied()
        .find(|known| *known == label)
        .unwrap_or(SHORTCUT_LABEL)
}

/// The plugin, with its handler. Only one shortcut is ever registered, so any
/// press that reaches the handler is the capture key.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::<tauri::Wry>::new()
        .with_handler(move |app, _pressed, event| {
            if event.state() == ShortcutState::Pressed {
                toggle(app);
            }
        })
        .build()
}

fn register(app: &AppHandle, label: &str) -> CaptureStatus {
    let label = known_label(label);
    let _ = app.global_shortcut().unregister_all();
    match app.global_shortcut().register(parse_shortcut(label)) {
        Ok(()) => {
            log::info!("quick capture on {label}");
            CaptureStatus {
                shortcut: label,
                registered: true,
                problem: None,
            }
        }
        Err(error) => {
            log::warn!("quick capture shortcut {label} not registered: {error}");
            CaptureStatus {
                shortcut: label,
                registered: false,
                problem: Some(
                    "another program owns this key combination; use the tray menu or the palette"
                        .to_string(),
                ),
            }
        }
    }
}

/// Create the (hidden) capture window and claim the shortcut. Called in setup.
pub fn install(app: &AppHandle, label: &str) -> tauri::Result<()> {
    build_window(app)?;
    let status = register(app, label);
    app.manage(CaptureState(Mutex::new(status)));
    Ok(())
}

/// Bind a different combination, from Settings. The outcome replaces the
/// status Diagnostics reads.
pub fn rebind(app: &AppHandle, label: &str) {
    let status = register(app, label);
    if let Some(state) = app.try_state::<CaptureState>() {
        if let Ok(mut current) = state.0.lock() {
            *current = status;
        }
    }
}

fn build_window(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(WINDOW).is_some() {
        return Ok(());
    }

    // The same bundle as the main window; the interface reads the label and
    // renders the capture line. Hidden until summoned, above everything while
    // shown, absent from the taskbar — a flyout, not an application window.
    WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::App("index.html".into()))
        .title("Quick capture")
        .inner_size(680.0, 168.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .center()
        .build()?;
    Ok(())
}

/// Show the capture line, or hide it if it is already up.
pub fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW) else {
        if let Err(error) = build_window(app) {
            log::error!("the capture window could not be built: {error}");
            return;
        }
        return toggle(app);
    };

    if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    show(app);
}

/// Bring the capture line up, empty and focused.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to(WINDOW, SHOWN_EVENT, ());
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.hide();
    }
}

/// What Diagnostics shows.
pub fn status(app: &AppHandle) -> CaptureStatus {
    app.try_state::<CaptureState>()
        .and_then(|state| state.0.lock().ok().map(|s| s.clone()))
        .unwrap_or(CaptureStatus {
            shortcut: SHORTCUT_LABEL,
            registered: false,
            problem: Some("quick capture has not started".to_string()),
        })
}
