//! Document commands.

use tauri::State;

use crate::db::models::{Block, BlockChanges};
use crate::db::{blocks, Db};
use crate::error::Result;

#[tauri::command]
pub fn blocks_list(db: State<'_, Db>, owner_kind: String, owner_id: String) -> Result<Vec<Block>> {
    let conn = db.0.lock().expect("the database lock was poisoned");
    blocks::list_blocks(&conn, &owner_kind, &owner_id)
}

/// Apply a document change set and reindex, in one transaction.
///
/// `plain_text` is the flattened document, supplied by the caller: knowing that
/// a heading's text lives at `content[0].text` is the editor's business, not the
/// host's.
#[tauri::command]
pub fn blocks_apply(
    db: State<'_, Db>,
    owner_kind: String,
    owner_id: String,
    changes: BlockChanges,
    plain_text: String,
) -> Result<Vec<Block>> {
    let mut conn = db.0.lock().expect("the database lock was poisoned");
    blocks::apply_changes(&mut conn, &owner_kind, &owner_id, changes, &plain_text)
}
