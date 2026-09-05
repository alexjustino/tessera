//! The typed boundary between the host and the interface.
//!
//! A command is thin: it validates, delegates and returns. Rules live in
//! `src/domain/` (TypeScript, pure); storage lives in `db`; the operating
//! system lives in `os`.

pub mod blocks;
pub mod calendar;
pub mod capture;
pub mod data;
pub mod dependencies;
pub mod importing;
pub mod items;
pub mod properties;
pub mod reminders;
pub mod search;
pub mod settings;
pub mod system;
pub mod templates;
pub mod time_entries;
pub mod views;
