//! The typed boundary between the host and the interface.
//!
//! A command is thin: it validates, delegates and returns. Rules live in
//! `src/domain/` (TypeScript, pure); storage lives in `db`; the operating
//! system lives in `os`.

pub mod items;
pub mod system;
