//! Templates, stored — and applied.
//!
//! Storage is plain: a name and a JSON body the domain layer shaped and will
//! check on the way back. Applying is the part that has to be careful: a
//! template of five tasks and three dependencies is one thing to the person
//! pressing the button, so it is one transaction here. Either every task
//! exists and every link holds, or nothing changed.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::dependencies;
use super::items::{self, now};
use super::models::{Item, NewItem};
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Template {
    pub id: String,
    pub name: String,
    /// The body as stored. Opaque here; `readBody` in the domain checks it.
    pub body_json: String,
    pub created_at: String,
    pub updated_at: String,
}

fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Template> {
    Ok(Template {
        id: row.get(0)?,
        name: row.get(1)?,
        body_json: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

/// Every template, by name.
pub fn list(conn: &Connection) -> Result<Vec<Template>> {
    let mut statement = conn.prepare(
        "SELECT id, name, body_json, created_at, updated_at FROM template
         ORDER BY name COLLATE NOCASE, created_at",
    )?;
    let rows = statement.query_map([], read)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Template> {
    conn.query_row(
        "SELECT id, name, body_json, created_at, updated_at FROM template WHERE id = ?1",
        params![id],
        read,
    )
    .optional()?
    .ok_or(Error::NotFound)
}

/// Save a template. The body must at least be JSON: a body that is not is a
/// bug in the caller, and refusing it here keeps the table readable.
pub fn create(conn: &Connection, name: &str, body_json: &str) -> Result<Template> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::InvalidInput("a template needs a name"));
    }
    if serde_json::from_str::<serde_json::Value>(body_json).is_err() {
        return Err(Error::InvalidInput("that is not a template"));
    }
    let id = Uuid::now_v7().to_string();
    let timestamp = now();
    conn.execute(
        "INSERT INTO template (id, name, body_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, name, body_json, timestamp],
    )?;
    get(conn, &id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute("DELETE FROM template WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

// ── Applying ───────────────────────────────────────────────────────────────

/// One task to create, dates already decided by the domain layer.
#[derive(Debug, Clone, Deserialize)]
pub struct PlannedTask {
    pub key: String,
    pub title: String,
    pub position: String,
    pub start_at: Option<String>,
    pub due_at: Option<String>,
    pub estimate_minutes: Option<i64>,
    pub is_milestone: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlannedEdge {
    pub blocker_key: String,
    pub blocked_key: String,
}

/// Create every task and every link, or none of them.
///
/// Keys are the template's; ids are minted here and the edges are resolved
/// through the mapping before they are linked. An edge naming a key with no
/// task is refused before anything is written — the domain checks this too,
/// but a transaction that would half-apply is worth refusing twice.
pub fn apply(
    conn: &mut Connection,
    collection_id: &str,
    tasks: &[PlannedTask],
    edges: &[PlannedEdge],
) -> Result<Vec<Item>> {
    let keys: std::collections::HashSet<&str> =
        tasks.iter().map(|task| task.key.as_str()).collect();
    if keys.len() != tasks.len() {
        return Err(Error::InvalidInput("a template task key is repeated"));
    }
    for edge in edges {
        if !keys.contains(edge.blocker_key.as_str()) || !keys.contains(edge.blocked_key.as_str()) {
            return Err(Error::InvalidInput(
                "a dependency names a task the template does not have",
            ));
        }
    }
    if tasks
        .iter()
        .any(|task| task.estimate_minutes.is_some_and(|m| m < 0))
    {
        return Err(Error::InvalidInput("an estimate cannot be negative"));
    }

    let transaction = conn.transaction()?;
    let mut ids = std::collections::HashMap::new();
    let timestamp = now();

    for task in tasks {
        let id = items::insert_item(
            &transaction,
            &NewItem {
                collection_id: collection_id.to_string(),
                title: task.title.clone(),
                position: task.position.clone(),
            },
        )?;
        transaction.execute(
            "UPDATE item SET start_at = ?2, due_at = ?3, estimate_minutes = ?4,
                             is_milestone = ?5, updated_at = ?6
             WHERE id = ?1",
            params![
                id,
                task.start_at,
                task.due_at,
                task.estimate_minutes,
                task.is_milestone as i64,
                timestamp
            ],
        )?;
        ids.insert(task.key.as_str(), id);
    }
    for edge in edges {
        dependencies::link(
            &transaction,
            &ids[edge.blocker_key.as_str()],
            &ids[edge.blocked_key.as_str()],
        )?;
    }
    transaction.commit()?;

    tasks
        .iter()
        .map(|task| items::get_item(conn, &ids[task.key.as_str()]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).unwrap();
        conn
    }

    fn planned(key: &str, title: &str, position: &str, due: Option<&str>) -> PlannedTask {
        PlannedTask {
            key: key.into(),
            title: title.into(),
            position: position.into(),
            start_at: None,
            due_at: due.map(String::from),
            estimate_minutes: Some(60),
            is_milestone: false,
        }
    }

    fn edge(blocker: &str, blocked: &str) -> PlannedEdge {
        PlannedEdge {
            blocker_key: blocker.into(),
            blocked_key: blocked.into(),
        }
    }

    #[test]
    fn a_template_is_saved_listed_and_removed() {
        let conn = workspace();
        let saved = create(&conn, "  Launch ", r#"{"tasks":[],"edges":[]}"#).unwrap();
        assert_eq!(saved.name, "Launch");
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert_eq!(get(&conn, &saved.id).unwrap(), saved);

        delete(&conn, &saved.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        assert!(matches!(
            delete(&conn, &saved.id).unwrap_err(),
            Error::NotFound
        ));
    }

    #[test]
    fn a_nameless_or_unreadable_template_is_refused() {
        let conn = workspace();
        assert!(matches!(
            create(&conn, "   ", "{}").unwrap_err(),
            Error::InvalidInput(_)
        ));
        assert!(matches!(
            create(&conn, "Broken", "not json").unwrap_err(),
            Error::InvalidInput(_)
        ));
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn applying_creates_every_task_and_every_link() {
        let mut conn = workspace();
        let created = apply(
            &mut conn,
            "tasks",
            &[
                planned("t1", "Kick-off", "a", Some("2026-10-05T12:00:00.000Z")),
                planned("t2", "Build it", "b", Some("2026-10-08T17:00:00.000Z")),
                planned("t3", "Launch", "c", None),
            ],
            &[edge("t1", "t2"), edge("t2", "t3")],
        )
        .unwrap();

        assert_eq!(created.len(), 3);
        assert_eq!(created[0].title, "Kick-off");
        assert_eq!(
            created[0].due_at.as_deref(),
            Some("2026-10-05T12:00:00.000Z")
        );
        assert_eq!(created[0].estimate_minutes, Some(60));
        assert!(created[2].due_at.is_none());

        let edges = dependencies::list(&conn).unwrap();
        assert_eq!(edges.len(), 2);
        assert!(edges
            .iter()
            .any(|e| e.blocker_id == created[0].id && e.blocked_id == created[1].id));
        assert!(edges
            .iter()
            .any(|e| e.blocker_id == created[1].id && e.blocked_id == created[2].id));
    }

    #[test]
    fn applying_twice_makes_two_independent_sets() {
        let mut conn = workspace();
        let tasks = [planned("t1", "A", "a", None), planned("t2", "B", "b", None)];
        let first = apply(&mut conn, "tasks", &tasks, &[edge("t1", "t2")]).unwrap();
        let second = apply(&mut conn, "tasks", &tasks, &[edge("t1", "t2")]).unwrap();
        assert_ne!(first[0].id, second[0].id);
        assert_eq!(
            items::list_items(&conn, Some("tasks"), false)
                .unwrap()
                .len(),
            4
        );
        assert_eq!(dependencies::list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn an_edge_to_a_missing_key_leaves_nothing_behind() {
        let mut conn = workspace();
        let refused = apply(
            &mut conn,
            "tasks",
            &[planned("t1", "Only", "a", None)],
            &[edge("t1", "ghost")],
        );
        assert!(matches!(refused.unwrap_err(), Error::InvalidInput(_)));
        assert!(items::list_items(&conn, Some("tasks"), false)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_failure_partway_leaves_nothing_behind() {
        let mut conn = workspace();
        // The second task has an empty title, which `insert_item` refuses —
        // after the first was already written inside the transaction.
        let refused = apply(
            &mut conn,
            "tasks",
            &[
                planned("t1", "Fine", "a", None),
                planned("t2", "   ", "b", None),
            ],
            &[],
        );
        assert!(refused.is_err());
        assert!(items::list_items(&conn, Some("tasks"), false)
            .unwrap()
            .is_empty());
    }
}
