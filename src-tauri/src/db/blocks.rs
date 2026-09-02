//! The block repository: an item's document, one row per top-level node.
//!
//! Writes arrive as a change set the domain layer computed — creates, updates
//! and deletes — and are applied in a single transaction. That shape is chosen,
//! not incidental. A document must never be half-saved: a transaction that
//! commits the deletes and fails the creates leaves a person looking at an item
//! whose body has silently lost paragraphs.
//!
//! The host does not read the nodes. What each block type means, and how a tree
//! becomes rows, is `src/domain/document.ts` (ADR-003). The one thing the host
//! does interpret is the plain text it is given for the search index, and even
//! that is flattened upstream, because knowing that a heading's text lives at
//! `content[0].text` is the editor's business.

use rusqlite::{params, Connection, Row};

use super::items::now;
use super::models::{Block, BlockChanges};
use crate::error::{Error, Result};

/// The longest document the interface will store, in blocks.
///
/// Generous, and finite. A runaway paste should fail with a sentence rather
/// than quietly writing a million rows.
const MAX_BLOCKS: usize = 10_000;

const POSITION_DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

fn check_position(position: &str) -> Result<()> {
    if position.is_empty() || !position.bytes().all(|b| POSITION_DIGITS.contains(&b)) {
        return Err(Error::InvalidInput(
            "that block order key is not a valid key",
        ));
    }
    Ok(())
}

fn read_block(row: &Row<'_>) -> rusqlite::Result<Block> {
    let content: String = row.get("content_json")?;
    Ok(Block {
        id: row.get("id")?,
        owner_kind: row.get("owner_kind")?,
        owner_id: row.get("owner_id")?,
        r#type: row.get("type")?,
        position: row.get("position")?,
        // A block whose JSON cannot be parsed is handed over as an empty
        // paragraph rather than failing the document. Losing one block is bad;
        // refusing to open the item at all is worse.
        content: serde_json::from_str(&content)
            .unwrap_or_else(|_| serde_json::json!({ "type": "paragraph" })),
    })
}

/// One owner's document, in order.
pub fn list_blocks(conn: &Connection, owner_kind: &str, owner_id: &str) -> Result<Vec<Block>> {
    let mut statement = conn.prepare(
        "SELECT id, owner_kind, owner_id, type, position, content_json
         FROM block
         WHERE owner_kind = ?1 AND owner_id = ?2 AND parent_block_id IS NULL
         ORDER BY position",
    )?;
    let rows = statement.query_map(params![owner_kind, owner_id], read_block)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Apply a change set, and reindex the document, in one transaction.
///
/// `plain_text` is the whole document flattened, supplied by the caller. It is
/// written to the search index in the same transaction as the blocks, so the
/// index cannot describe a document that was never saved.
pub fn apply_changes(
    conn: &mut Connection,
    owner_kind: &str,
    owner_id: &str,
    changes: BlockChanges,
    plain_text: &str,
) -> Result<Vec<Block>> {
    if changes.creates.len() > MAX_BLOCKS {
        return Err(Error::InvalidInput("that document is too long to store"));
    }

    for create in &changes.creates {
        check_position(&create.position)?;
    }
    for update in &changes.updates {
        check_position(&update.position)?;
    }

    let timestamp = now();
    let transaction = conn.transaction()?;

    for id in &changes.deletes {
        transaction.execute("DELETE FROM block WHERE id = ?1", params![id])?;
    }

    for update in &changes.updates {
        let changed = transaction.execute(
            "UPDATE block SET type = ?2, position = ?3, content_json = ?4, updated_at = ?5
             WHERE id = ?1",
            params![
                update.id,
                update.r#type,
                update.position,
                update.content.to_string(),
                timestamp
            ],
        )?;
        // A block the editor believed in but the database does not have is a
        // real disagreement, not something to paper over by inserting it.
        if changed == 0 {
            return Err(Error::NotFound);
        }
    }

    for create in &changes.creates {
        transaction.execute(
            "INSERT INTO block (id, owner_kind, owner_id, type, position, content_json,
                                created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                create.id,
                owner_kind,
                owner_id,
                create.r#type,
                create.position,
                create.content.to_string(),
                timestamp
            ],
        )?;
    }

    // Reindex. `search_fts` is standalone, so nothing does this automatically —
    // and an index that describes a document nobody saved is worse than none,
    // because only the person searching finds out.
    let indexed = transaction.execute(
        "UPDATE search_fts SET body = ?3 WHERE owner_kind = ?1 AND owner_id = ?2",
        params![owner_kind, owner_id, plain_text],
    )?;
    if indexed == 0 {
        // An owner with no index row yet — an event, or an item written before
        // the index existed.
        transaction.execute(
            "INSERT INTO search_fts (owner_kind, owner_id, title, body) VALUES (?1, ?2, '', ?3)",
            params![owner_kind, owner_id, plain_text],
        )?;
    }

    if owner_kind == "item" {
        transaction.execute(
            "UPDATE item SET updated_at = ?2 WHERE id = ?1",
            params![owner_id, timestamp],
        )?;
    }

    transaction.commit()?;
    list_blocks(conn, owner_kind, owner_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items::create_item;
    use crate::db::migrations;
    use crate::db::models::{BlockCreate, BlockUpdate, NewItem};
    use serde_json::{json, Value};

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    fn an_item(conn: &mut Connection) -> String {
        create_item(
            conn,
            NewItem {
                collection_id: "tasks".into(),
                title: "a task".into(),
                position: "V".into(),
            },
        )
        .expect("create")
        .id
    }

    fn paragraph(text: &str) -> Value {
        json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] })
    }

    fn creates(entries: &[(&str, &str, &str)]) -> BlockChanges {
        BlockChanges {
            creates: entries
                .iter()
                .map(|(id, position, text)| BlockCreate {
                    id: (*id).into(),
                    r#type: "paragraph".into(),
                    position: (*position).into(),
                    content: paragraph(text),
                })
                .collect(),
            updates: vec![],
            deletes: vec![],
        }
    }

    #[test]
    fn a_new_item_has_no_document() {
        let mut conn = workspace();
        let item = an_item(&mut conn);
        assert!(list_blocks(&conn, "item", &item).expect("list").is_empty());
    }

    #[test]
    fn blocks_come_back_in_key_order_whatever_order_they_were_written() {
        let mut conn = workspace();
        let item = an_item(&mut conn);

        apply_changes(
            &mut conn,
            "item",
            &item,
            creates(&[("b2", "b", "Second"), ("b1", "a", "First")]),
            "First\nSecond",
        )
        .expect("apply");

        let blocks = list_blocks(&conn, "item", &item).expect("list");
        assert_eq!(
            blocks.iter().map(|b| b.id.as_str()).collect::<Vec<_>>(),
            ["b1", "b2"]
        );
    }

    #[test]
    fn an_update_touches_only_the_block_it_names() {
        let mut conn = workspace();
        let item = an_item(&mut conn);
        apply_changes(
            &mut conn,
            "item",
            &item,
            creates(&[("b1", "a", "First"), ("b2", "b", "Second")]),
            "First\nSecond",
        )
        .expect("apply");

        apply_changes(
            &mut conn,
            "item",
            &item,
            BlockChanges {
                creates: vec![],
                updates: vec![BlockUpdate {
                    id: "b2".into(),
                    r#type: "paragraph".into(),
                    position: "b".into(),
                    content: paragraph("Second, edited"),
                }],
                deletes: vec![],
            },
            "First\nSecond, edited",
        )
        .expect("apply");

        let blocks = list_blocks(&conn, "item", &item).expect("list");
        assert_eq!(blocks[0].content, paragraph("First"));
        assert_eq!(blocks[1].content, paragraph("Second, edited"));
    }

    #[test]
    fn the_search_index_follows_the_document() {
        let mut conn = workspace();
        let item = an_item(&mut conn);

        apply_changes(
            &mut conn,
            "item",
            &item,
            creates(&[("b1", "a", "the rescission clause")]),
            "the rescission clause",
        )
        .expect("apply");

        let found: i64 = conn
            .query_row(
                "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'rescission'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        assert_eq!(found, 1, "the document was not indexed");

        apply_changes(
            &mut conn,
            "item",
            &item,
            BlockChanges {
                creates: vec![],
                updates: vec![BlockUpdate {
                    id: "b1".into(),
                    r#type: "paragraph".into(),
                    position: "a".into(),
                    content: paragraph("nothing to see"),
                }],
                deletes: vec![],
            },
            "nothing to see",
        )
        .expect("apply");

        let stale: i64 = conn
            .query_row(
                "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'rescission'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        assert_eq!(stale, 0, "the index still describes the old document");
    }

    #[test]
    fn deleting_the_item_takes_its_document_with_it() {
        let mut conn = workspace();
        let item = an_item(&mut conn);
        apply_changes(
            &mut conn,
            "item",
            &item,
            creates(&[("b1", "a", "text")]),
            "text",
        )
        .expect("apply");

        crate::db::items::delete_item(&mut conn, &item).expect("delete");

        // The block table keys on owner_kind/owner_id rather than a foreign key,
        // because one editor serves items, events and pages — so nothing
        // cascades on its own and `delete_item` has to sweep the document
        // itself. Without this the database leaks a row per paragraph, forever.
        let orphans: i64 = conn
            .query_row(
                "SELECT count(*) FROM block WHERE owner_id = ?1",
                params![item],
                |row| row.get(0),
            )
            .unwrap_or(-1);
        assert_eq!(orphans, 0, "deleting an item left its document behind");
    }

    // ── Negative cases ──────────────────────────────────────────────────────

    #[test]
    fn a_failed_change_set_leaves_the_document_exactly_as_it_was() {
        // The reason this is one transaction. A half-saved document silently
        // loses paragraphs, and the person only finds out later.
        let mut conn = workspace();
        let item = an_item(&mut conn);
        apply_changes(
            &mut conn,
            "item",
            &item,
            creates(&[("b1", "a", "First"), ("b2", "b", "Second")]),
            "First\nSecond",
        )
        .expect("apply");

        let result = apply_changes(
            &mut conn,
            "item",
            &item,
            BlockChanges {
                creates: vec![],
                updates: vec![BlockUpdate {
                    id: "does-not-exist".into(),
                    r#type: "paragraph".into(),
                    position: "c".into(),
                    content: paragraph("ghost"),
                }],
                deletes: vec!["b1".into()],
            },
            "ghost",
        );

        assert!(matches!(result, Err(Error::NotFound)));

        let blocks = list_blocks(&conn, "item", &item).expect("list");
        assert_eq!(
            blocks.len(),
            2,
            "the delete committed even though the update failed"
        );
        assert_eq!(blocks[0].content, paragraph("First"));
    }

    #[test]
    fn refuses_an_order_key_that_could_not_have_come_from_the_domain() {
        let mut conn = workspace();
        let item = an_item(&mut conn);

        let result = apply_changes(
            &mut conn,
            "item",
            &item,
            creates(&[("b1", "not a key!", "text")]),
            "text",
        );

        assert!(matches!(result, Err(Error::InvalidInput(_))));
        assert!(list_blocks(&conn, "item", &item).expect("list").is_empty());
    }

    #[test]
    fn a_block_whose_json_is_broken_opens_as_an_empty_paragraph() {
        // Losing one block is bad. Refusing to open the item at all is worse.
        let mut conn = workspace();
        let item = an_item(&mut conn);
        apply_changes(
            &mut conn,
            "item",
            &item,
            creates(&[("b1", "a", "text")]),
            "text",
        )
        .expect("apply");

        conn.execute(
            "UPDATE block SET content_json = 'not json' WHERE id = 'b1'",
            [],
        )
        .expect("corrupt");

        let blocks = list_blocks(&conn, "item", &item).expect("list");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].content["type"], "paragraph");
    }
}
