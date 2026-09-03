//! Settings: one JSON document on the single workspace row.
//!
//! Typed here so a value the interface never wrote cannot arrive — a theme that
//! is not one of three, a shortcut the host cannot register, a retention of
//! zero backups. Unknown keys in the stored document are dropped on read rather
//! than failing it: a setting from a newer build is not a reason to lose the
//! others.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The key combinations quick capture may be bound to. A closed list: each one
/// is known to be free on a stock Windows install, and a free-text binding
/// would let a person take a key away from the operating system by accident.
pub const SHORTCUTS: &[&str] = &[
    "Ctrl+Alt+Space",
    "Ctrl+Alt+T",
    "Ctrl+Shift+Space",
    "Ctrl+Alt+N",
];

pub const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+Space";

/// The most backups rotation will keep; more than this is a disk, not a safety net.
pub const MAX_BACKUPS_KEPT: u32 = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    /// `system`, `light` or `dark`.
    pub theme: String,
    /// `comfortable` or `compact`.
    pub density: String,
    /// One of [`SHORTCUTS`].
    pub quick_capture_shortcut: String,
    /// Whether a backup is taken on the first start of each day.
    pub backups_enabled: bool,
    /// How many backups rotation keeps.
    pub backups_keep: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            density: "comfortable".to_string(),
            quick_capture_shortcut: DEFAULT_SHORTCUT.to_string(),
            backups_enabled: true,
            backups_keep: 7,
        }
    }
}

impl Settings {
    /// Reject anything the product cannot honour, in a sentence.
    pub fn validate(&self) -> Result<()> {
        if !["system", "light", "dark"].contains(&self.theme.as_str()) {
            return Err(Error::InvalidInput("that is not a theme"));
        }
        if !["comfortable", "compact"].contains(&self.density.as_str()) {
            return Err(Error::InvalidInput("that is not a density"));
        }
        if !SHORTCUTS.contains(&self.quick_capture_shortcut.as_str()) {
            return Err(Error::InvalidInput(
                "that key combination is not one quick capture can use",
            ));
        }
        if self.backups_keep == 0 || self.backups_keep > MAX_BACKUPS_KEPT {
            return Err(Error::InvalidInput("keep between 1 and 50 backups"));
        }
        Ok(())
    }
}

/// Read the settings. A document that cannot be read at all yields the defaults
/// and a log line — the workspace opens either way.
pub fn get(conn: &Connection) -> Result<Settings> {
    let raw: String = conn.query_row(
        "SELECT settings_json FROM workspace WHERE id = 1",
        [],
        |r| r.get(0),
    )?;
    Ok(
        serde_json::from_str::<Settings>(&raw).unwrap_or_else(|error| {
            log::warn!("settings could not be read ({error}); using defaults");
            Settings::default()
        }),
    )
}

/// Replace the settings, after validation.
pub fn set(conn: &Connection, settings: &Settings) -> Result<Settings> {
    settings.validate()?;
    let json = serde_json::to_string(settings).expect("settings serialise");
    conn.execute(
        "UPDATE workspace SET settings_json = ?1 WHERE id = 1",
        params![json],
    )?;
    get(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrations::apply(&conn).unwrap();
        conn
    }

    #[test]
    fn a_fresh_workspace_has_the_defaults() {
        let conn = workspace();
        assert_eq!(get(&conn).unwrap(), Settings::default());
        assert_eq!(get(&conn).unwrap().quick_capture_shortcut, DEFAULT_SHORTCUT);
        assert!(get(&conn).unwrap().backups_enabled);
    }

    #[test]
    fn a_change_is_stored_and_read_back() {
        let conn = workspace();
        let wanted = Settings {
            theme: "dark".into(),
            density: "compact".into(),
            quick_capture_shortcut: "Ctrl+Alt+T".into(),
            backups_enabled: false,
            backups_keep: 3,
        };
        assert_eq!(set(&conn, &wanted).unwrap(), wanted);
        assert_eq!(get(&conn).unwrap(), wanted);
    }

    #[test]
    fn values_the_product_cannot_honour_are_refused_in_a_sentence() {
        let conn = workspace();
        let bad = Settings {
            theme: "sepia".into(),
            ..Settings::default()
        };
        assert!(matches!(
            set(&conn, &bad).unwrap_err(),
            Error::InvalidInput(_)
        ));
        let bad = Settings {
            quick_capture_shortcut: "Win+L".into(),
            ..Settings::default()
        };
        assert!(matches!(
            set(&conn, &bad).unwrap_err(),
            Error::InvalidInput(_)
        ));
        let bad = Settings {
            backups_keep: 0,
            ..Settings::default()
        };
        assert!(matches!(
            set(&conn, &bad).unwrap_err(),
            Error::InvalidInput(_)
        ));
        // Nothing was written by the refused calls.
        assert_eq!(get(&conn).unwrap(), Settings::default());
    }

    #[test]
    fn unknown_keys_and_missing_keys_do_not_lose_the_rest() {
        let conn = workspace();
        conn.execute(
            "UPDATE workspace SET settings_json = '{\"theme\":\"light\",\"from_the_future\":1}' WHERE id = 1",
            [],
        )
        .unwrap();
        let read = get(&conn).unwrap();
        assert_eq!(read.theme, "light");
        assert_eq!(read.density, "comfortable");
    }

    #[test]
    fn a_document_that_is_not_json_falls_back_to_defaults() {
        let conn = workspace();
        conn.execute(
            "UPDATE workspace SET settings_json = 'garbage' WHERE id = 1",
            [],
        )
        .unwrap();
        assert_eq!(get(&conn).unwrap(), Settings::default());
    }
}
