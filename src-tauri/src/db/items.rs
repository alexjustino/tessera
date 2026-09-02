//! The item repository: create, read, complete, rename, delete.
//!
//! Thin by design. There is no filtering, no grouping and no ordering logic
//! here — those are the query engine's job, in pure TypeScript (ADR-004). What
//! lives here is what only the host can do: transactions, and keeping the
//! full-text index in step with the rows it describes.
//!
//! Keeping FTS in step is the one thing worth watching. `search_fts` is a
//! standalone table rather than an external-content one, so nothing updates it
//! automatically: every write path that touches a title touches the index in the
//! same transaction. A search index that silently drifts from the data is worse
//! than no search at all, because the user cannot tell.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use super::models::{Collection, Item, NewItem};
use crate::error::{Error, Result};

/// The longest title the interface will store. Long enough for any real title,
/// short enough that a paste accident cannot put a megabyte in a row.
const MAX_TITLE: usize = 2_000;

/// The alphabet fractional index keys are drawn from (ADR-006).
const POSITION_DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// An ISO-8601 instant in UTC, millisecond precision. Local wall-clock time is
/// never written to the database (ADR-013).
pub fn now() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// A fresh identifier. Version 7 is time-ordered, so rows created together sit
/// together in the index instead of scattering across it.
fn new_id() -> String {
    Uuid::now_v7().to_string()
}

/// Trim and check a title. An empty title is rejected rather than stored: a row
/// the user cannot see or name is a row they cannot delete either.
fn clean_title(title: &str) -> Result<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(Error::InvalidInput("a title cannot be empty"));
    }
    if trimmed.chars().count() > MAX_TITLE {
        return Err(Error::InvalidInput("that title is too long"));
    }
    Ok(trimmed.to_string())
}

/// Check the *shape* of an order key.
///
/// This is a boundary check, not a second implementation: the algorithm that
/// produces keys lives in `src/domain/ordering.ts` and stays there. The host
/// only refuses a value that could not have come from it, so a bug upstream
/// surfaces as an error rather than as a list that silently sorts wrong.
fn check_position(position: &str) -> Result<()> {
    if position.is_empty() {
        return Err(Error::InvalidInput("an order key cannot be empty"));
    }
    if !position.bytes().all(|b| POSITION_DIGITS.contains(&b)) {
        return Err(Error::InvalidInput("that order key is not a valid key"));
    }
    Ok(())
}

fn read_collection(row: &Row<'_>) -> rusqlite::Result<Collection> {
    Ok(Collection {
        id: row.get("id")?,
        name: row.get("name")?,
        icon: row.get("icon")?,
        color: row.get("color")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn read_item(row: &Row<'_>) -> rusqlite::Result<Item> {
    Ok(Item {
        id: row.get("id")?,
        collection_id: row.get("collection_id")?,
        parent_item_id: row.get("parent_item_id")?,
        title: row.get("title")?,
        position: row.get("position")?,
        completed_at: row.get("completed_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Every collection that has not been archived, in order.
pub fn list_collections(conn: &Connection) -> Result<Vec<Collection>> {
    let mut statement = conn.prepare(
        "SELECT id, name, icon, color, position, created_at, updated_at
         FROM collection
         WHERE archived_at IS NULL
         ORDER BY position",
    )?;
    let rows = statement.query_map([], read_collection)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Items in a collection — or across all of them when `collection_id` is None.
///
/// Ordering is by the fractional key, which is exactly the order the interface
/// shows, so the list does not have to be re-sorted after it arrives.
pub fn list_items(
    conn: &Connection,
    collection_id: Option<&str>,
    include_completed: bool,
) -> Result<Vec<Item>> {
    let sql = format!(
        "SELECT id, collection_id, parent_item_id, title, position,
                completed_at, created_at, updated_at
         FROM item
         WHERE archived_at IS NULL
           AND (?1 IS NULL OR collection_id = ?1)
           {}
         ORDER BY position",
        if include_completed {
            ""
        } else {
            "AND completed_at IS NULL"
        }
    );

    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![collection_id], read_item)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Read one item, or report that it is gone.
pub fn get_item(conn: &Connection, id: &str) -> Result<Item> {
    conn.query_row(
        "SELECT id, collection_id, parent_item_id, title, position,
                completed_at, created_at, updated_at
         FROM item WHERE id = ?1",
        params![id],
        read_item,
    )
    .optional()?
    .ok_or(Error::NotFound)
}

/// Create an item and index it, in one transaction.
pub fn create_item(conn: &mut Connection, new: NewItem) -> Result<Item> {
    let title = clean_title(&new.title)?;
    check_position(&new.position)?;

    let id = new_id();
    let timestamp = now();

    let transaction = conn.transaction()?;
    transaction.execute(
        "INSERT INTO item (id, collection_id, title, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, new.collection_id, title, new.position, timestamp],
    )?;
    transaction.execute(
        "INSERT INTO search_fts (owner_kind, owner_id, title, body)
         VALUES ('item', ?1, ?2, '')",
        params![id, title],
    )?;
    transaction.commit()?;

    get_item(conn, &id)
}

/// Mark an item complete or bring it back.
///
/// `completed_at` carries both the state and when it happened, so "what did I
/// finish this week" is a query rather than a separate history table.
pub fn set_completed(conn: &Connection, id: &str, completed: bool) -> Result<Item> {
    let timestamp = now();
    let changed = conn.execute(
        "UPDATE item
         SET completed_at = CASE WHEN ?2 THEN ?3 ELSE NULL END,
             updated_at = ?3
         WHERE id = ?1",
        params![id, completed, timestamp],
    )?;

    if changed == 0 {
        return Err(Error::NotFound);
    }
    get_item(conn, id)
}

/// Rename an item, keeping the search index in step.
pub fn rename_item(conn: &mut Connection, id: &str, title: &str) -> Result<Item> {
    let title = clean_title(title)?;
    let timestamp = now();

    let transaction = conn.transaction()?;
    let changed = transaction.execute(
        "UPDATE item SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, title, timestamp],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    transaction.execute(
        "UPDATE search_fts SET title = ?2 WHERE owner_kind = 'item' AND owner_id = ?1",
        params![id, title],
    )?;
    transaction.commit()?;

    get_item(conn, id)
}

/// Move an item to a new position, and optionally into another collection.
pub fn move_item(
    conn: &Connection,
    id: &str,
    position: &str,
    collection_id: Option<&str>,
) -> Result<Item> {
    check_position(position)?;
    let timestamp = now();

    let changed = conn.execute(
        "UPDATE item
         SET position = ?2,
             collection_id = COALESCE(?3, collection_id),
             updated_at = ?4
         WHERE id = ?1",
        params![id, position, collection_id, timestamp],
    )?;

    if changed == 0 {
        return Err(Error::NotFound);
    }
    get_item(conn, id)
}

/// Delete an item and everything that describes it.
///
/// Sub-items go with it through `ON DELETE CASCADE`; the search rows do not,
/// because `search_fts` is standalone, so they are removed here explicitly.
pub fn delete_item(conn: &mut Connection, id: &str) -> Result<()> {
    let transaction = conn.transaction()?;

    let descendants: Vec<String> = {
        let mut statement = transaction.prepare(
            "WITH RECURSIVE tree(id) AS (
                 SELECT id FROM item WHERE id = ?1
                 UNION ALL
                 SELECT item.id FROM item JOIN tree ON item.parent_item_id = tree.id
             )
             SELECT id FROM tree",
        )?;
        let rows = statement.query_map(params![id], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    if descendants.is_empty() {
        return Err(Error::NotFound);
    }

    // Neither the search index nor the document cascades on its own: both key
    // on owner_kind/owner_id rather than a foreign key, because one editor and
    // one index serve items, events and pages alike. So both are swept here,
    // for the item and every descendant, or the database leaks a row per
    // paragraph forever.
    for descendant in &descendants {
        transaction.execute(
            "DELETE FROM search_fts WHERE owner_kind = 'item' AND owner_id = ?1",
            params![descendant],
        )?;
        transaction.execute(
            "DELETE FROM block WHERE owner_kind = 'item' AND owner_id = ?1",
            params![descendant],
        )?;
    }
    transaction.execute("DELETE FROM item WHERE id = ?1", params![id])?;
    transaction.commit()?;

    Ok(())
}

/// Move a card on a board: its position and the field the columns group by, in
/// one transaction.
///
/// Two separate calls would be two round trips with a window between them, and
/// a failure in that window leaves a card sitting in one column while the data
/// says another. On a board that is not a subtle inconsistency — it is a task
/// that looks done and is not.
///
/// `value` of null clears the field, which is what dropping into the "no value"
/// column means.
pub fn move_on_board(
    conn: &mut Connection,
    id: &str,
    position: &str,
    property_id: Option<&str>,
    value: &serde_json::Value,
) -> Result<Item> {
    check_position(position)?;
    let timestamp = now();

    let transaction = conn.transaction()?;

    let changed = transaction.execute(
        "UPDATE item SET position = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, position, timestamp],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }

    if let Some(property_id) = property_id {
        if value.is_null() {
            transaction.execute(
                "DELETE FROM item_property_value WHERE item_id = ?1 AND property_id = ?2",
                params![id, property_id],
            )?;
        } else {
            transaction.execute(
                "INSERT INTO item_property_value (item_id, property_id, value_json)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT (item_id, property_id) DO UPDATE SET value_json = excluded.value_json",
                params![id, property_id, value.to_string()],
            )?;
        }
    }

    transaction.commit()?;
    get_item(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn workspace() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        // Keep the borrow checker happy about `&mut` helpers below.
        conn.pragma_update(None, "busy_timeout", 1_000).unwrap();
        let _ = &mut conn;
        conn
    }

    fn add(conn: &mut Connection, title: &str, position: &str) -> Item {
        create_item(
            conn,
            NewItem {
                collection_id: "tasks".into(),
                title: title.into(),
                position: position.into(),
            },
        )
        .expect("create")
    }

    #[test]
    fn a_new_workspace_has_somewhere_to_write() {
        let conn = workspace();
        let collections = list_collections(&conn).expect("list");

        assert_eq!(collections.len(), 1);
        assert_eq!(collections[0].id, "tasks");
        assert_eq!(collections[0].name, "Tasks");
    }

    #[test]
    fn seeding_the_default_collection_is_idempotent() {
        // Migration 002 must not create a second collection on a database that
        // already has one, however many times migrations are applied.
        let conn = workspace();
        migrations::apply(&conn).expect("re-apply");

        assert_eq!(list_collections(&conn).expect("list").len(), 1);
    }

    #[test]
    fn creates_reads_and_lists_in_key_order() {
        let mut conn = workspace();
        add(&mut conn, "second", "b");
        add(&mut conn, "first", "a");
        add(&mut conn, "third", "c");

        let items = list_items(&conn, Some("tasks"), false).expect("list");
        let titles: Vec<_> = items.iter().map(|i| i.title.as_str()).collect();

        assert_eq!(titles, ["first", "second", "third"]);
    }

    #[test]
    fn completing_records_when_it_happened_and_hides_it_by_default() {
        let mut conn = workspace();
        let item = add(&mut conn, "write the spec", "V");

        let done = set_completed(&conn, &item.id, true).expect("complete");
        assert!(done.is_completed());
        assert!(done.completed_at.is_some());

        assert!(list_items(&conn, Some("tasks"), false)
            .expect("list")
            .is_empty());
        assert_eq!(
            list_items(&conn, Some("tasks"), true).expect("list").len(),
            1
        );

        let reopened = set_completed(&conn, &item.id, false).expect("reopen");
        assert!(!reopened.is_completed());
        assert!(reopened.completed_at.is_none());
    }

    #[test]
    fn renaming_keeps_the_search_index_in_step() {
        // The failure this guards against is silent: the row says one thing and
        // search says another, and only the user notices, much later.
        let mut conn = workspace();
        let item = add(&mut conn, "buy milk", "V");

        // The old and new titles share no token, deliberately. `MATCH 'buy milk'`
        // is an implicit AND over two terms, not a phrase, so renaming to
        // "buy oat milk" would still match and the test would pass while proving
        // nothing.
        rename_item(&mut conn, &item.id, "call the plumber").expect("rename");

        let stale: i64 = conn
            .query_row(
                "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'milk'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let fresh: i64 = conn
            .query_row(
                "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'plumber'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        assert_eq!(stale, 0, "the old title is still indexed");
        assert_eq!(fresh, 1, "the new title was not indexed");
    }

    #[test]
    fn deleting_removes_the_row_and_its_index_entry() {
        let mut conn = workspace();
        let item = add(&mut conn, "obsolete", "V");

        delete_item(&mut conn, &item.id).expect("delete");

        assert!(matches!(get_item(&conn, &item.id), Err(Error::NotFound)));
        let indexed: i64 = conn
            .query_row(
                "SELECT count(*) FROM search_fts WHERE owner_id = ?1",
                params![item.id],
                |r| r.get(0),
            )
            .unwrap_or(-1);
        assert_eq!(indexed, 0, "the search index kept a row for a deleted item");
    }

    #[test]
    fn deleting_a_parent_takes_its_children_and_their_index_entries() {
        let mut conn = workspace();
        let parent = add(&mut conn, "parent", "V");
        let child = create_item(
            &mut conn,
            NewItem {
                collection_id: "tasks".into(),
                title: "child".into(),
                position: "V".into(),
            },
        )
        .expect("create child");
        conn.execute(
            "UPDATE item SET parent_item_id = ?2 WHERE id = ?1",
            params![child.id, parent.id],
        )
        .expect("nest");

        delete_item(&mut conn, &parent.id).expect("delete");

        assert!(matches!(get_item(&conn, &child.id), Err(Error::NotFound)));
        let orphaned: i64 = conn
            .query_row("SELECT count(*) FROM search_fts", [], |r| r.get(0))
            .unwrap_or(-1);
        assert_eq!(orphaned, 0, "a cascaded child left its index entry behind");
    }

    #[test]
    fn a_board_move_writes_the_position_and_the_field_together() {
        let mut conn = workspace();
        let item = add(&mut conn, "movable", "V");

        let moved = move_on_board(
            &mut conn,
            &item.id,
            "a",
            Some("tasks.status"),
            &serde_json::json!("doing"),
        )
        .expect("move");

        assert_eq!(moved.position, "a");
        let stored: String = conn
            .query_row(
                "SELECT value_json FROM item_property_value
                 WHERE item_id = ?1 AND property_id = 'tasks.status'",
                params![item.id],
                |row| row.get(0),
            )
            .expect("the field was not written");
        assert_eq!(stored, "\"doing\"");
    }

    #[test]
    fn a_board_move_into_the_no_value_column_clears_the_field() {
        let mut conn = workspace();
        let item = add(&mut conn, "movable", "V");
        move_on_board(
            &mut conn,
            &item.id,
            "a",
            Some("tasks.status"),
            &serde_json::json!("done"),
        )
        .expect("set");

        move_on_board(
            &mut conn,
            &item.id,
            "b",
            Some("tasks.status"),
            &serde_json::Value::Null,
        )
        .expect("clear");

        let rows: i64 = conn
            .query_row(
                "SELECT count(*) FROM item_property_value WHERE item_id = ?1",
                params![item.id],
                |row| row.get(0),
            )
            .unwrap_or(-1);
        assert_eq!(rows, 0);
    }

    #[test]
    fn a_board_move_leaves_nothing_half_written_when_it_fails() {
        // The whole reason this is one call: a card must never sit in one column
        // while the data says another.
        let mut conn = workspace();
        let item = add(&mut conn, "movable", "V");

        let result = move_on_board(
            &mut conn,
            &item.id,
            "a",
            Some("does-not-exist"),
            &serde_json::json!("doing"),
        );

        assert!(result.is_err());
        assert_eq!(
            get_item(&conn, &item.id).expect("still there").position,
            "V",
            "the position was written even though the field write failed"
        );
    }

    #[test]
    fn a_board_move_reports_a_missing_item() {
        let mut conn = workspace();
        assert!(matches!(
            move_on_board(&mut conn, "nope", "V", None, &serde_json::Value::Null),
            Err(Error::NotFound)
        ));
    }

    #[test]
    fn moving_changes_position_and_collection() {
        let mut conn = workspace();
        let item = add(&mut conn, "movable", "V");

        let moved = move_item(&conn, &item.id, "a", None).expect("move");
        assert_eq!(moved.position, "a");
        assert_eq!(moved.collection_id, "tasks");
    }

    // ── Negative cases ──────────────────────────────────────────────────────

    #[test]
    fn refuses_an_empty_or_whitespace_title() {
        let mut conn = workspace();
        for title in ["", "   ", "\t\n"] {
            let result = create_item(
                &mut conn,
                NewItem {
                    collection_id: "tasks".into(),
                    title: title.into(),
                    position: "V".into(),
                },
            );
            assert!(
                matches!(result, Err(Error::InvalidInput(_))),
                "accepted {title:?}"
            );
        }
        assert!(list_items(&conn, None, true).expect("list").is_empty());
    }

    #[test]
    fn trims_a_title_rather_than_storing_the_padding() {
        let mut conn = workspace();
        let item = add(&mut conn, "  padded  ", "V");
        assert_eq!(item.title, "padded");
    }

    #[test]
    fn refuses_an_order_key_that_could_not_have_come_from_the_domain() {
        let mut conn = workspace();
        for position in ["", "a b", "a-b", "café"] {
            let result = create_item(
                &mut conn,
                NewItem {
                    collection_id: "tasks".into(),
                    title: "valid".into(),
                    position: position.into(),
                },
            );
            assert!(
                matches!(result, Err(Error::InvalidInput(_))),
                "accepted position {position:?}"
            );
        }
    }

    #[test]
    fn reports_a_missing_item_rather_than_pretending() {
        let mut conn = workspace();
        assert!(matches!(get_item(&conn, "nope"), Err(Error::NotFound)));
        assert!(matches!(
            set_completed(&conn, "nope", true),
            Err(Error::NotFound)
        ));
        assert!(matches!(
            rename_item(&mut conn, "nope", "x"),
            Err(Error::NotFound)
        ));
        assert!(matches!(
            delete_item(&mut conn, "nope"),
            Err(Error::NotFound)
        ));
        assert!(matches!(
            move_item(&conn, "nope", "V", None),
            Err(Error::NotFound)
        ));
    }

    #[test]
    fn a_failed_create_leaves_nothing_behind() {
        // The transaction must roll back the row *and* the index entry together.
        let mut conn = workspace();
        let _ = create_item(
            &mut conn,
            NewItem {
                collection_id: "does-not-exist".into(),
                title: "orphan".into(),
                position: "V".into(),
            },
        );

        let items: i64 = conn
            .query_row("SELECT count(*) FROM item", [], |r| r.get(0))
            .unwrap_or(-1);
        let indexed: i64 = conn
            .query_row("SELECT count(*) FROM search_fts", [], |r| r.get(0))
            .unwrap_or(-1);

        assert_eq!(items, 0, "a rejected create left an item row");
        assert_eq!(indexed, 0, "a rejected create left a search row");
    }
}
