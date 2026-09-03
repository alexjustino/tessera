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

/// The combination the specification names. Free on a stock Windows install —
/// `Win+` combinations are the operating system's, and `Alt+Space` alone is the
/// window menu.
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

fn shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space)
}

/// The plugin, with its handler. Registered on the builder before setup.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let wanted = shortcut();
    tauri_plugin_global_shortcut::Builder::<tauri::Wry>::new()
        .with_handler(move |app, pressed, event| {
            if event.state() == ShortcutState::Pressed && pressed == &wanted {
                toggle(app);
            }
        })
        .build()
}

/// Create the (hidden) capture window and claim the shortcut. Called in setup.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    build_window(app)?;

    let status = match app.global_shortcut().register(shortcut()) {
        Ok(()) => {
            log::info!("quick capture on {SHORTCUT_LABEL}");
            CaptureStatus {
                shortcut: SHORTCUT_LABEL,
                registered: true,
                problem: None,
            }
        }
        Err(error) => {
            log::warn!("quick capture shortcut not registered: {error}");
            CaptureStatus {
                shortcut: SHORTCUT_LABEL,
                registered: false,
                problem: Some(
                    "another program owns this key combination; use the tray menu or the palette"
                        .to_string(),
                ),
            }
        }
    };
    app.manage(CaptureState(Mutex::new(status)));
    Ok(())
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
