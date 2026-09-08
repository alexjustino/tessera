//! Goals — an intention with a finish line, and the tasks that count for it.
//!
//! The host stores four things and computes none of them: a name, what the
//! number means, the number, and which tasks were put in. Progress is worked
//! out in the domain from rows that already exist (ADR-024), so a goal can
//! never hold a total that disagrees with the work.
//!
//! Membership is a join table, and both sides cascade. A goal that counted a
//! task nobody can open would be a number with nothing behind it, which is the
//! one thing a goal is not allowed to be.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::items::now;
use crate::error::{Error, Result};

/// The longest a name may be, matching the domain's own limit.
const MAX_NAME: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Goal {
    pub id: String,
    pub name: String,
    pub measure: String,
    pub target: i64,
    pub due_day: Option<String>,
    pub position: String,
    pub created_at: String,
    pub updated_at: String,
}

/// One task counting towards one goal.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GoalLink {
    pub goal_id: String,
    pub item_id: String,
}

/// What a caller may change about a goal. Absent fields are left alone.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct GoalPatch {
    pub name: Option<String>,
    pub measure: Option<String>,
    pub target: Option<i64>,
    /// `Some(None)` clears the day; `None` leaves it as it was.
    #[serde(default, deserialize_with = "double_option")]
    pub due_day: Option<Option<String>>,
}

/// Distinguish "not sent" from "sent as null", for a field that is nullable.
fn double_option<'de, D>(deserializer: D) -> std::result::Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(deserializer).map(Some)
}

fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id: row.get(0)?,
        name: row.get(1)?,
        measure: row.get(2)?,
        target: row.get(3)?,
        due_day: row.get(4)?,
        position: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const COLUMNS: &str =
    "id, name, measure, target, due_day, position, created_at, updated_at FROM goal";

fn check_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::InvalidInput("a goal needs a name"));
    }
    if trimmed.chars().count() > MAX_NAME {
        return Err(Error::InvalidInput("that name is too long for a goal"));
    }
    Ok(trimmed.to_string())
}

fn check_measure(measure: &str) -> Result<()> {
    if measure == "tasks" || measure == "minutes" {
        Ok(())
    } else {
        Err(Error::InvalidInput("a goal counts tasks or minutes"))
    }
}

fn check_target(target: i64) -> Result<()> {
    if target > 0 {
        Ok(())
    } else {
        Err(Error::InvalidInput("a goal needs something to reach"))
    }
}

/// A day as `2026-12-31`, or nothing. Anything else is refused rather than
/// stored: a date the calendar cannot read is a deadline nobody is warned of.
fn check_day(day: Option<&str>) -> Result<Option<String>> {
    match day {
        None => Ok(None),
        Some(value) if value.trim().is_empty() => Ok(None),
        Some(value) => {
            let bytes = value.as_bytes();
            let shaped = value.len() == 10
                && bytes[4] == b'-'
                && bytes[7] == b'-'
                && value
                    .split('-')
                    .all(|part| part.chars().all(|c| c.is_ascii_digit()));
            if shaped {
                Ok(Some(value.to_string()))
            } else {
                Err(Error::InvalidInput("that is not a day"))
            }
        }
    }
}

pub fn list(conn: &Connection) -> Result<Vec<Goal>> {
    let mut statement = conn.prepare(&format!("SELECT {COLUMNS} ORDER BY position, created_at"))?;
    let rows = statement.query_map([], read)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Goal> {
    conn.query_row(
        &format!("SELECT {COLUMNS} WHERE id = ?1"),
        params![id],
        read,
    )
    .optional()?
    .ok_or(Error::NotFound)
}

pub fn create(
    conn: &Connection,
    name: &str,
    measure: &str,
    target: i64,
    due_day: Option<&str>,
    position: &str,
) -> Result<Goal> {
    let name = check_name(name)?;
    check_measure(measure)?;
    check_target(target)?;
    let day = check_day(due_day)?;
    let timestamp = now();
    let id = Uuid::now_v7().to_string();

    conn.execute(
        "INSERT INTO goal (id, name, measure, target, due_day, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, name, measure, target, day, position, timestamp],
    )?;
    get(conn, &id)
}

/// Change a goal. What is not sent is left as it was.
pub fn update(conn: &Connection, id: &str, patch: GoalPatch) -> Result<Goal> {
    let current = get(conn, id)?;

    let name = match patch.name.as_deref() {
        Some(value) => check_name(value)?,
        None => current.name,
    };
    let measure = match patch.measure.as_deref() {
        Some(value) => {
            check_measure(value)?;
            value.to_string()
        }
        None => current.measure,
    };
    let target = match patch.target {
        Some(value) => {
            check_target(value)?;
            value
        }
        None => current.target,
    };
    let day = match patch.due_day {
        Some(value) => check_day(value.as_deref())?,
        None => current.due_day,
    };

    conn.execute(
        "UPDATE goal SET name = ?2, measure = ?3, target = ?4, due_day = ?5, updated_at = ?6
         WHERE id = ?1",
        params![id, name, measure, target, day, now()],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute("DELETE FROM goal WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

/// Every membership, both ways round — the client joins them in memory.
pub fn links(conn: &Connection) -> Result<Vec<GoalLink>> {
    let mut statement = conn.prepare("SELECT goal_id, item_id FROM goal_item")?;
    let rows = statement.query_map([], |row| {
        Ok(GoalLink {
            goal_id: row.get(0)?,
            item_id: row.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Put a task in a goal. Doing it twice is not an error: it is already in.
pub fn link(conn: &Connection, goal_id: &str, item_id: &str) -> Result<()> {
    get(conn, goal_id)?;
    let exists: bool = conn
        .query_row("SELECT 1 FROM item WHERE id = ?1", params![item_id], |_| {
            Ok(true)
        })
        .optional()?
        .unwrap_or(false);
    if !exists {
        return Err(Error::NotFound);
    }
    conn.execute(
        "INSERT OR IGNORE INTO goal_item (goal_id, item_id) VALUES (?1, ?2)",
        params![goal_id, item_id],
    )?;
    conn.execute(
        "UPDATE goal SET updated_at = ?2 WHERE id = ?1",
        params![goal_id, now()],
    )?;
    Ok(())
}

/// Take a task out of a goal. Taking out what is not in is not an error.
pub fn unlink(conn: &Connection, goal_id: &str, item_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM goal_item WHERE goal_id = ?1 AND item_id = ?2",
        params![goal_id, item_id],
    )?;
    conn.execute(
        "UPDATE goal SET updated_at = ?2 WHERE id = ?1",
        params![goal_id, now()],
    )?;
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

    fn goal(conn: &Connection, name: &str) -> Goal {
        create(conn, name, "tasks", 3, Some("2026-12-31"), "m").unwrap()
    }

    fn task(conn: &mut Connection, title: &str) -> String {
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
    fn a_goal_needs_a_name_a_measure_and_something_to_reach() {
        let conn = workspace();
        assert!(create(&conn, "  ", "tasks", 3, None, "m").is_err());
        assert!(create(&conn, "Ship it", "vibes", 3, None, "m").is_err());
        assert!(create(&conn, "Ship it", "tasks", 0, None, "m").is_err());
        assert!(create(&conn, "Ship it", "tasks", -2, None, "m").is_err());
        assert!(create(&conn, "Ship it", "tasks", 3, Some("31/12/2026"), "m").is_err());
        assert!(create(&conn, "Ship it", "tasks", 3, Some("2026-12-31"), "m").is_ok());
    }

    #[test]
    fn a_patch_changes_what_it_names_and_leaves_the_rest() {
        let conn = workspace();
        let made = goal(&conn, "Ship 1.2");

        let renamed = update(
            &conn,
            &made.id,
            GoalPatch {
                name: Some("Ship 1.3".into()),
                ..GoalPatch::default()
            },
        )
        .unwrap();
        assert_eq!(renamed.name, "Ship 1.3");
        assert_eq!(renamed.target, 3);
        assert_eq!(renamed.due_day.as_deref(), Some("2026-12-31"));

        // Sent as null, the day is cleared; not sent at all, it stays.
        let cleared = update(
            &conn,
            &made.id,
            GoalPatch {
                due_day: Some(None),
                ..GoalPatch::default()
            },
        )
        .unwrap();
        assert_eq!(cleared.due_day, None);
        assert_eq!(cleared.name, "Ship 1.3");
    }

    #[test]
    fn a_task_goes_in_once_however_many_times_it_is_put_in() {
        let mut conn = workspace();
        let made = goal(&conn, "Ship 1.2");
        let item = task(&mut conn, "Write the brief");

        link(&conn, &made.id, &item).unwrap();
        link(&conn, &made.id, &item).unwrap();
        assert_eq!(links(&conn).unwrap().len(), 1);

        unlink(&conn, &made.id, &item).unwrap();
        unlink(&conn, &made.id, &item).unwrap();
        assert_eq!(links(&conn).unwrap(), vec![]);
    }

    #[test]
    fn a_goal_refuses_a_task_that_does_not_exist() {
        let conn = workspace();
        let made = goal(&conn, "Ship 1.2");
        assert!(link(&conn, &made.id, "no-such-task").is_err());
        assert!(link(&conn, "no-such-goal", "no-such-task").is_err());
    }

    #[test]
    fn deleting_either_side_takes_the_membership_with_it() {
        let mut conn = workspace();
        let made = goal(&conn, "Ship 1.2");
        let kept = task(&mut conn, "Write the brief");
        let gone = task(&mut conn, "A task about to go");
        link(&conn, &made.id, &kept).unwrap();
        link(&conn, &made.id, &gone).unwrap();

        // A deleted task leaves every goal it counted for.
        items::delete_item(&mut conn, &gone).unwrap();
        assert_eq!(links(&conn).unwrap().len(), 1);

        // And a deleted goal forgets its rows.
        delete(&conn, &made.id).unwrap();
        assert_eq!(links(&conn).unwrap(), vec![]);
        assert!(get(&conn, &made.id).is_err());
    }
}
