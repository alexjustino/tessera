//! A task and the notes about it: a pair a person made, from either side.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ItemPage {
    pub item_id: String,
    pub page_id: String,
}

/// Every pair, both ways round. The client joins them in memory, as it does goals.
pub fn list(conn: &Connection) -> Result<Vec<ItemPage>> {
    let mut statement = conn.prepare("SELECT item_id, page_id FROM item_page")?;
    let rows = statement.query_map([], |row| {
        Ok(ItemPage {
            item_id: row.get(0)?,
            page_id: row.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Pair them. Doing it twice is one pair.
pub fn link(conn: &Connection, item_id: &str, page_id: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO item_page (item_id, page_id) VALUES (?1, ?2)",
        params![item_id, page_id],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Error::NotFound
        }
        other => other.into(),
    })?;
    Ok(())
}

pub fn unlink(conn: &Connection, item_id: &str, page_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM item_page WHERE item_id = ?1 AND page_id = ?2",
        params![item_id, page_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn.execute_batch(
            "INSERT INTO item (id, collection_id, title, position, created_at, updated_at)
             VALUES ('task', 'tasks', 'Nozomi', 'm', '2026-01-01', '2026-01-01');
             INSERT INTO page (id, title, title_key, position, created_at, updated_at)
             VALUES ('note', 'Nozomi notes', 'nozomi notes', 'm', '2026-01-01', '2026-01-01');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn a_task_and_a_page_can_be_paired_and_parted() {
        let conn = workspace();
        link(&conn, "task", "note").unwrap();
        assert_eq!(
            list(&conn).unwrap(),
            vec![ItemPage {
                item_id: "task".into(),
                page_id: "note".into()
            }]
        );
        unlink(&conn, "task", "note").unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn pairing_twice_is_one_pair() {
        let conn = workspace();
        link(&conn, "task", "note").unwrap();
        link(&conn, "task", "note").unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn either_side_going_takes_only_the_pair() {
        let conn = workspace();
        link(&conn, "task", "note").unwrap();
        conn.execute("DELETE FROM page WHERE id = 'note'", [])
            .unwrap();
        assert!(list(&conn).unwrap().is_empty());
        let tasks: i64 = conn
            .query_row("SELECT count(*) FROM item WHERE id = 'task'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(tasks, 1);
    }

    #[test]
    fn it_cannot_pair_what_does_not_exist() {
        let conn = workspace();
        assert!(link(&conn, "nobody", "note").is_err());
        assert!(link(&conn, "task", "nothing").is_err());
    }
}
