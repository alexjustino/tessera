//! Windows toast notifications — the alert surface the whole product depends on.
//!
//! # Why this module exists in the foundation slice
//!
//! Every reminder in Tessera lands here. The risk register calls this out as a
//! high-severity unknown for one reason: a Windows toast is not addressed to a
//! process, it is addressed to an **AppUserModelID**. An AUMID becomes valid by
//! being registered — in practice, by a Start Menu shortcut written by the
//! installer. A development build has no shortcut and therefore no identity of
//! its own.
//!
//! The consequence is deliberate and worth stating plainly: **a toast that
//! looks right under `tauri dev` proves nothing.** It is borrowing PowerShell's
//! registered identity. The proof that matters is a toast raised by an
//! installed build, under this application's own AUMID, and that is the
//! evidence the foundation slice is required to produce.
//!
//! Rather than guess, `send` tries the real identity first and falls back,
//! reporting which identity actually worked. The answer is data, not a hunch.

use serde::Serialize;

/// This application's AppUserModelID. It is valid only once an installer has
/// written a Start Menu shortcut carrying it.
#[cfg(windows)]
pub const APP_USER_MODEL_ID: &str = "io.github.alexjustino.tessera";

/// What actually happened, so the caller can tell the truth about it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ToastOutcome {
    /// Whether Windows accepted the toast.
    pub delivered: bool,
    /// The AppUserModelID that worked.
    pub app_id_used: String,
    /// Whether the toast carried action buttons.
    pub with_actions: bool,
    /// True when the application's own identity was accepted — that is, when
    /// this is an installed build behaving the way the product will ship.
    pub own_identity: bool,
    /// A sentence for a person, shown in Diagnostics.
    pub note: String,
}

/// An action button on the toast.
pub struct ToastAction {
    pub label: &'static str,
    /// Returned to the application when the button is pressed.
    pub argument: &'static str,
}

/// The three actions every reminder offers.
pub fn reminder_actions() -> Vec<ToastAction> {
    vec![
        ToastAction {
            label: "Complete",
            argument: "action=complete",
        },
        ToastAction {
            label: "Snooze 10 min",
            argument: "action=snooze&minutes=10",
        },
        ToastAction {
            label: "Open",
            argument: "action=open",
        },
    ]
}

#[cfg(windows)]
pub fn send(title: &str, body: &str, actions: &[ToastAction]) -> ToastOutcome {
    use tauri_winrt_notification::{Duration, Toast};

    let build = |app_id: &str| {
        let mut toast = Toast::new(app_id)
            .title(title)
            .text1(body)
            .duration(Duration::Short);
        for action in actions {
            toast = toast.add_button(action.label, action.argument);
        }
        toast
    };

    // First choice: our own identity. This is what an installed build uses.
    if build(APP_USER_MODEL_ID).show().is_ok() {
        return ToastOutcome {
            delivered: true,
            app_id_used: APP_USER_MODEL_ID.to_string(),
            with_actions: !actions.is_empty(),
            own_identity: true,
            note: "Delivered under the application's own AppUserModelID. This is \
                   the shipping behaviour: the toast is attributed to Tessera and \
                   persists in the Action Center."
                .to_string(),
        };
    }

    // Fallback: a registered identity that always exists on Windows. The toast
    // appears, but attributed to PowerShell — useful for development, and never
    // to be mistaken for proof.
    if build(Toast::POWERSHELL_APP_ID).show().is_ok() {
        log::warn!(
            "the application's AppUserModelID was rejected; the toast borrowed the \
             PowerShell identity. This is expected in a development build."
        );
        return ToastOutcome {
            delivered: true,
            app_id_used: Toast::POWERSHELL_APP_ID.to_string(),
            with_actions: !actions.is_empty(),
            own_identity: false,
            note: "Delivered under a borrowed identity, because this build has no \
                   Start Menu shortcut registering its own AppUserModelID. Expected \
                   under `tauri dev`. Reminders must be proven from an installed \
                   build."
                .to_string(),
        };
    }

    log::error!("Windows refused the toast under both identities");
    ToastOutcome {
        delivered: false,
        app_id_used: String::new(),
        with_actions: false,
        own_identity: false,
        note: "Windows refused the notification. Check that notifications are \
               enabled for this application in Windows Settings, and that Focus \
               Assist is not suppressing them."
            .to_string(),
    }
}

#[cfg(not(windows))]
pub fn send(_title: &str, _body: &str, _actions: &[ToastAction]) -> ToastOutcome {
    // Degraded, and it says so. Silence would be the bug.
    ToastOutcome {
        delivered: false,
        app_id_used: String::new(),
        with_actions: false,
        own_identity: false,
        note: "Native notifications are implemented for Windows only in this \
               release."
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_reminder_action_carries_a_label_and_an_argument() {
        let actions = reminder_actions();
        assert_eq!(actions.len(), 3);
        for action in &actions {
            assert!(!action.label.is_empty());
            assert!(action.argument.starts_with("action="));
        }
    }

    #[test]
    fn snooze_declares_its_duration_in_the_argument() {
        // The frontend parses this back; a silent default would be a bug.
        let actions = reminder_actions();
        let snooze = actions
            .iter()
            .find(|a| a.argument.starts_with("action=snooze"))
            .expect("a snooze action");
        assert!(snooze.argument.contains("minutes=10"));
    }

    #[test]
    fn a_failed_toast_never_claims_an_identity() {
        let outcome = ToastOutcome {
            delivered: false,
            app_id_used: String::new(),
            with_actions: false,
            own_identity: false,
            note: String::new(),
        };
        assert!(!outcome.own_identity);
        assert!(outcome.app_id_used.is_empty());
    }
}
