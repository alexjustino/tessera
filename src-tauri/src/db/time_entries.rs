//! Time tracked, stored.
//!
//! Starting a timer while another runs stops the other one first, in the same
//! transaction. That is what every tracker does and what a person means: they
//! have moved on to something else, not asked for two clocks. The alternative —
//! refusing, and making them stop the first by hand — is a message where an
//! action would do.
//!
//! The invariant that at most one runs is the schema's, not this module's (a
//! partial unique index in migration 011). This module keeps it by being
//! careful; the index keeps it whatever anybody writes next.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::items::now;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimeEntry {
    pub id: String,
    pub item_id: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}

fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<TimeEntry> {
    Ok(TimeEntry {
        id: row.get(0)?,
        item_id: row.get(1)?,
        started_at: row.get(2)?,
        ended_at: row.get(3)?,
    })
}

/// Every entry, newest first.
///
/// The whole table: a workspace accumulates entries at the rate a person
/// starts and stops a clock, which is a handful a day. The totals are computed
/// in the domain layer, over everything, because "this week" and "this task"
/// and "this day" are all the same walk.
pub fn list(conn: &Connection) -> Result<Vec<TimeEntry>> {
    let mut statement = conn.prepare(
        "SELECT id, item_id, started_at, ended_at FROM time_entry ORDER BY started_at DESC",
    )?;
    let rows = statement.query_map([], read)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// The one running entry, if a timer is going.
pub fn running(conn: &Connection) -> Result<Option<TimeEntry>> {
    Ok(conn
        .query_row(
            "SELECT id, item_id, started_at, ended_at FROM time_entry WHERE ended_at IS NULL",
            [],
            read,
        )
        .optional()?)
}

/// Start timing a task, stopping whatever was running.
///
/// Returns the entry that is now running. Starting the task that is already
/// being timed changes nothing and returns it — a person pressing the button
/// twice meant to keep going, not to restart the clock.
pub fn start(conn: &mut Connection, item_id: &str) -> Result<TimeEntry> {
    let exists: i64 = conn.query_row(
        "SELECT count(*) FROM item WHERE id = ?1 AND archived_at IS NULL",
        params![item_id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(Error::NotFound);
    }

    if let Some(current) = running(conn)? {
        if current.item_id == item_id {
            return Ok(current);
        }
    }

    let timestamp = now();
    let id = Uuid::now_v7().to_string();

    let transaction = conn.transaction()?;
    // Stop whatever was running before the new row exists, or the index that
    // allows only one running timer refuses the insert — correctly.
    transaction.execute(
        "UPDATE time_entry SET ended_at = ?1 WHERE ended_at IS NULL",
        params![timestamp],
    )?;
    transaction.execute(
        "INSERT INTO time_entry (id, item_id, started_at, ended_at, created_at)
         VALUES (?1, ?2, ?3, NULL, ?3)",
        params![id, item_id, timestamp],
    )?;
    transaction.commit()?;

    running(conn)?.ok_or(Error::NotFound)
}

/// Stop the running timer. Stopping when nothing runs is not an error: the
/// intended state — no clock going — is the state that results.
pub fn stop(conn: &Connection) -> Result<Option<TimeEntry>> {
    let Some(current) = running(conn)? else {
        return Ok(None);
    };
    let ended = now();
    conn.execute(
        "UPDATE time_entry SET ended_at = ?2 WHERE id = ?1",
        params![current.id, ended],
    )?;
    Ok(Some(TimeEntry {
        ended_at: Some(ended),
        ..current
    }))
}

/// Time the clock never saw: an entry written by hand, already ended.
///
/// A running entry is only ever made by `start`, so this one must have an end;
/// the schema refuses an end before its start, and the message here says so
/// in words before the database has to.
pub fn add(
    conn: &Connection,
    item_id: &str,
    started_at: &str,
    ended_at: &str,
) -> Result<TimeEntry> {
    check_interval(started_at, ended_at)?;
    let exists: i64 = conn.query_row(
        "SELECT count(*) FROM item WHERE id = ?1 AND archived_at IS NULL",
        params![item_id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(Error::NotFound);
    }
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO time_entry (id, item_id, started_at, ended_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, item_id, started_at, ended_at, now()],
    )?;
    Ok(TimeEntry {
        id,
        item_id: item_id.to_string(),
        started_at: started_at.to_string(),
        ended_at: Some(ended_at.to_string()),
    })
}

/// Correct an entry's start and end. The corrected entry is always ended: a
/// person editing the times of a clock is not asking it to keep running.
pub fn update(conn: &Connection, id: &str, started_at: &str, ended_at: &str) -> Result<TimeEntry> {
    check_interval(started_at, ended_at)?;
    let changed = conn.execute(
        "UPDATE time_entry SET started_at = ?2, ended_at = ?3 WHERE id = ?1",
        params![id, started_at, ended_at],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    conn.query_row(
        "SELECT id, item_id, started_at, ended_at FROM time_entry WHERE id = ?1",
        params![id],
        read,
    )
    .map_err(Error::from)
}

/// The interval rule in words, before the schema's CHECK says it in SQL.
fn check_interval(started_at: &str, ended_at: &str) -> Result<()> {
    if started_at.is_empty() || ended_at.is_empty() {
        return Err(Error::InvalidInput("an entry needs a start and an end"));
    }
    if ended_at < started_at {
        return Err(Error::InvalidInput("an entry cannot end before it starts"));
    }
    Ok(())
}

/// Remove one entry — a timer left running by accident, a mistaken start.
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute("DELETE FROM time_entry WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items;
    use crate::db::migrations;
    use crate::db::models::NewItem;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).unwrap();
        conn
    }

    fn item(conn: &mut Connection, title: &str) -> String {
        items::create_item(
            conn,
            NewItem {
                collection_id: "tasks".into(),
                title: title.into(),
                position: "a".into(),
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn starting_leaves_a_running_entry() {
        let mut conn = workspace();
        let task = item(&mut conn, "Write it");

        let entry = start(&mut conn, &task).unwrap();
        assert_eq!(entry.item_id, task);
        assert!(entry.ended_at.is_none());
        assert_eq!(running(&conn).unwrap().unwrap().id, entry.id);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn starting_another_task_stops_the_first() {
        let mut conn = workspace();
        let first = item(&mut conn, "First");
        let second = item(&mut conn, "Second");

        let one = start(&mut conn, &first).unwrap();
        let two = start(&mut conn, &second).unwrap();

        assert_ne!(one.id, two.id);
        assert_eq!(running(&conn).unwrap().unwrap().item_id, second);

        let entries = list(&conn).unwrap();
        assert_eq!(entries.len(), 2);
        let stopped = entries.iter().find(|e| e.id == one.id).unwrap();
        assert!(stopped.ended_at.is_some(), "the first was left running");
    }

    #[test]
    fn starting_the_task_already_running_keeps_the_same_clock() {
        let mut conn = workspace();
        let task = item(&mut conn, "Keep going");

        let one = start(&mut conn, &task).unwrap();
        let again = start(&mut conn, &task).unwrap();

        assert_eq!(one.id, again.id);
        assert_eq!(one.started_at, again.started_at);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn the_schema_allows_only_one_running_timer() {
        let mut conn = workspace();
        let task = item(&mut conn, "One");
        start(&mut conn, &task).unwrap();

        // Going around the repository entirely: the index still refuses.
        let refused = conn.execute(
            "INSERT INTO time_entry (id, item_id, started_at, ended_at, created_at)
             VALUES ('sneaky', ?1, ?2, NULL, ?2)",
            params![task, now()],
        );
        assert!(refused.is_err(), "a second running timer was stored");
    }

    #[test]
    fn stopping_closes_the_entry_and_is_idempotent() {
        let mut conn = workspace();
        let task = item(&mut conn, "Stop me");
        start(&mut conn, &task).unwrap();

        let stopped = stop(&conn).unwrap().expect("something was running");
        assert!(stopped.ended_at.is_some());
        assert!(running(&conn).unwrap().is_none());

        // Stopping again is not an error; nothing is running either way.
        assert!(stop(&conn).unwrap().is_none());
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn a_running_timer_is_a_row_and_so_survives_being_reopened() {
        let mut conn = workspace();
        let task = item(&mut conn, "Long job");
        let entry = start(&mut conn, &task).unwrap();

        // Nothing in memory holds the timer: read it back cold.
        let found = running(&conn).unwrap().expect("still running");
        assert_eq!(found.id, entry.id);
        assert_eq!(found.started_at, entry.started_at);
    }

    #[test]
    fn timing_a_task_that_does_not_exist_says_so() {
        let mut conn = workspace();
        assert!(matches!(
            start(&mut conn, "ghost").unwrap_err(),
            Error::NotFound
        ));
    }

    #[test]
    fn an_entry_can_be_removed_and_removing_a_ghost_says_so() {
        let mut conn = workspace();
        let task = item(&mut conn, "Oops");
        let entry = start(&mut conn, &task).unwrap();

        delete(&conn, &entry.id).unwrap();
        assert!(running(&conn).unwrap().is_none());
        assert_eq!(list(&conn).unwrap().len(), 0);
        assert!(matches!(
            delete(&conn, "ghost").unwrap_err(),
            Error::NotFound
        ));
    }

    #[test]
    fn deleting_the_task_takes_its_entries_with_it() {
        let mut conn = workspace();
        let task = item(&mut conn, "Doomed");
        start(&mut conn, &task).unwrap();
        stop(&conn).unwrap();

        items::delete_item(&mut conn, &task).unwrap();

        assert_eq!(list(&conn).unwrap().len(), 0);
        let dangling: i64 = conn
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(dangling, 0);
    }

    #[test]
    fn an_entry_can_be_written_by_hand_and_is_already_ended() {
        let mut conn = workspace();
        let task = item(&mut conn, "Yesterday");
        let entry = add(
            &conn,
            &task,
            "2026-09-08T12:00:00.000Z",
            "2026-09-08T14:00:00.000Z",
        )
        .unwrap();
        assert_eq!(entry.ended_at.as_deref(), Some("2026-09-08T14:00:00.000Z"));
        assert!(
            running(&conn).unwrap().is_none(),
            "a hand-written entry must not run"
        );
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn a_hand_written_entry_that_ends_before_it_starts_is_refused_in_words() {
        let mut conn = workspace();
        let task = item(&mut conn, "Backwards");
        let refused = add(
            &conn,
            &task,
            "2026-09-08T14:00:00.000Z",
            "2026-09-08T12:00:00.000Z",
        );
        assert!(matches!(refused.unwrap_err(), Error::InvalidInput(_)));
        assert!(matches!(
            add(&conn, &task, "", "2026-09-08T12:00:00.000Z").unwrap_err(),
            Error::InvalidInput(_)
        ));
        assert!(matches!(
            add(
                &conn,
                "ghost",
                "2026-09-08T12:00:00.000Z",
                "2026-09-08T13:00:00.000Z"
            )
            .unwrap_err(),
            Error::NotFound
        ));
    }

    #[test]
    fn an_entry_can_be_corrected_and_a_running_one_stops_when_it_is() {
        let mut conn = workspace();
        let task = item(&mut conn, "Forgot to stop");
        let entry = start(&mut conn, &task).unwrap();

        let fixed = update(
            &conn,
            &entry.id,
            "2026-09-08T12:00:00.000Z",
            "2026-09-08T12:30:00.000Z",
        )
        .unwrap();
        assert_eq!(fixed.id, entry.id);
        assert_eq!(fixed.started_at, "2026-09-08T12:00:00.000Z");
        assert_eq!(fixed.ended_at.as_deref(), Some("2026-09-08T12:30:00.000Z"));
        assert!(running(&conn).unwrap().is_none());

        assert!(matches!(
            update(
                &conn,
                &entry.id,
                "2026-09-08T13:00:00.000Z",
                "2026-09-08T12:00:00.000Z"
            )
            .unwrap_err(),
            Error::InvalidInput(_)
        ));
        assert!(matches!(
            update(
                &conn,
                "ghost",
                "2026-09-08T12:00:00.000Z",
                "2026-09-08T13:00:00.000Z"
            )
            .unwrap_err(),
            Error::NotFound
        ));
    }

    #[test]
    fn an_entry_that_ends_before_it_starts_is_refused_by_the_schema() {
        let mut conn = workspace();
        let task = item(&mut conn, "Backwards");

        let refused = conn.execute(
            "INSERT INTO time_entry (id, item_id, started_at, ended_at, created_at)
             VALUES ('bad', ?1, '2026-09-08T12:00:00.000Z', '2026-09-08T11:00:00.000Z', ?2)",
            params![task, now()],
        );
        assert!(refused.is_err());
    }
}
