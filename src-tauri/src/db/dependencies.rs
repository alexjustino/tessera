//! The dependency graph, stored.
//!
//! The interesting rule is the one this module will not let through: the graph
//! stays acyclic. A cycle is work that can never start, and a workspace that
//! holds one is a workspace whose timeline, critical path and capacity figures
//! are all lies.
//!
//! Two layers check it, and they are not duplicates of each other (ADR-019).
//! The interface asks `src/domain/graph.ts` before it offers the link, so it
//! can name the chain — "Ship it → Test it → Fix it → Ship it" — with the
//! titles it already has. This module asks SQLite the reachability question
//! directly, because storage integrity is not something to delegate to a
//! caller. One answers *which* loop, for a person; the other answers *whether*,
//! for the file.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::items::now;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Dependency {
    pub blocker_id: String,
    pub blocked_id: String,
    pub created_at: String,
}

/// Every edge in the workspace.
///
/// The whole graph, not a slice of it: the questions asked of it — what is
/// ready, what is on the critical path, would this close a loop — are all
/// global, and a workspace's edges number in the hundreds where its items
/// number in the thousands.
pub fn list(conn: &Connection) -> Result<Vec<Dependency>> {
    let mut statement = conn.prepare(
        "SELECT blocker_id, blocked_id, created_at FROM item_dependency
         ORDER BY created_at, blocker_id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Dependency {
            blocker_id: row.get(0)?,
            blocked_id: row.get(1)?,
            created_at: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Whether `blocker` can already be reached by following the arrows out of
/// `blocked` — which is exactly when adding `blocker → blocked` closes a loop.
///
/// `UNION` rather than `UNION ALL`: it de-duplicates, which is what makes the
/// walk terminate even on a graph that somehow already holds a cycle.
fn would_close_a_loop(conn: &Connection, blocker_id: &str, blocked_id: &str) -> Result<bool> {
    let found: i64 = conn.query_row(
        "WITH RECURSIVE reach(id) AS (
             SELECT ?2
             UNION
             SELECT d.blocked_id
             FROM item_dependency d
             JOIN reach r ON d.blocker_id = r.id
         )
         SELECT count(*) FROM reach WHERE id = ?1",
        params![blocker_id, blocked_id],
        |row| row.get(0),
    )?;
    Ok(found > 0)
}

fn must_exist(conn: &Connection, id: &str) -> Result<()> {
    let found: i64 = conn.query_row(
        "SELECT count(*) FROM item WHERE id = ?1 AND archived_at IS NULL",
        params![id],
        |row| row.get(0),
    )?;
    if found == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

/// State that `blocker` must finish before `blocked` may start.
///
/// Idempotent: saying it twice is not an error, because the interface offers
/// the link from two places and a person should not have to remember which.
pub fn link(conn: &Connection, blocker_id: &str, blocked_id: &str) -> Result<()> {
    if blocker_id == blocked_id {
        return Err(Error::InvalidInput("a task cannot wait for itself"));
    }
    must_exist(conn, blocker_id)?;
    must_exist(conn, blocked_id)?;

    if would_close_a_loop(conn, blocker_id, blocked_id)? {
        return Err(Error::InvalidInput(
            "that would make a loop of work that could never start",
        ));
    }

    conn.execute(
        "INSERT INTO item_dependency (blocker_id, blocked_id, created_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT (blocker_id, blocked_id) DO NOTHING",
        params![blocker_id, blocked_id, now()],
    )?;
    Ok(())
}

/// Remove the edge. Removing one that is not there is not an error: the
/// intended state — these two are unrelated — is the state that results.
pub fn unlink(conn: &Connection, blocker_id: &str, blocked_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM item_dependency WHERE blocker_id = ?1 AND blocked_id = ?2",
        params![blocker_id, blocked_id],
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

    /// design → build → test, as ids.
    fn chain(conn: &mut Connection) -> (String, String, String) {
        let design = item(conn, "Design it");
        let build = item(conn, "Build it");
        let test = item(conn, "Test it");
        link(conn, &design, &build).unwrap();
        link(conn, &build, &test).unwrap();
        (design, build, test)
    }

    #[test]
    fn an_edge_is_stored_and_read_back() {
        let mut conn = workspace();
        let (design, build, _) = chain(&mut conn);

        let edges = list(&conn).unwrap();
        assert_eq!(edges.len(), 2);
        assert_eq!(edges[0].blocker_id, design);
        assert_eq!(edges[0].blocked_id, build);
        assert!(!edges[0].created_at.is_empty());
    }

    #[test]
    fn saying_it_twice_changes_nothing() {
        let mut conn = workspace();
        let (design, build, _) = chain(&mut conn);

        link(&conn, &design, &build).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn a_task_cannot_wait_for_itself() {
        let mut conn = workspace();
        let id = item(&mut conn, "Alone");

        let error = link(&conn, &id, &id).unwrap_err();
        assert!(matches!(error, Error::InvalidInput(_)));
        assert_eq!(list(&conn).unwrap().len(), 0);
    }

    #[test]
    fn the_storage_refuses_a_loop_however_long() {
        let mut conn = workspace();
        let (design, _, test) = chain(&mut conn);

        // test → design would close design → build → test → design.
        let error = link(&conn, &test, &design).unwrap_err();
        assert!(matches!(error, Error::InvalidInput(_)));
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn an_edge_that_only_shortens_a_route_is_allowed() {
        let mut conn = workspace();
        let (design, _, test) = chain(&mut conn);

        // design already reaches test through build; saying it directly is
        // redundant, not circular.
        link(&conn, &design, &test).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 3);
    }

    #[test]
    fn an_edge_needs_two_items_that_exist() {
        let mut conn = workspace();
        let real = item(&mut conn, "Real");

        assert!(matches!(
            link(&conn, &real, "ghost").unwrap_err(),
            Error::NotFound
        ));
        assert!(matches!(
            link(&conn, "ghost", &real).unwrap_err(),
            Error::NotFound
        ));
        assert_eq!(list(&conn).unwrap().len(), 0);
    }

    #[test]
    fn unlinking_is_idempotent_and_leaves_the_rest() {
        let mut conn = workspace();
        let (design, build, test) = chain(&mut conn);

        unlink(&conn, &design, &build).unwrap();
        unlink(&conn, &design, &build).unwrap();

        let edges = list(&conn).unwrap();
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].blocker_id, build);
        assert_eq!(edges[0].blocked_id, test);
    }

    #[test]
    fn deleting_a_task_takes_its_edges_with_it() {
        let mut conn = workspace();
        let (_, build, _) = chain(&mut conn);

        items::delete_item(&mut conn, &build).unwrap();

        // build was in the middle of the chain, so both edges went with it —
        // rather than leaving rows pointing at a task that is gone.
        assert_eq!(list(&conn).unwrap().len(), 0);
        let dangling: i64 = conn
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(dangling, 0);
    }

    #[test]
    fn a_diamond_is_fine_and_closing_it_is_not() {
        let mut conn = workspace();
        let a = item(&mut conn, "A");
        let b = item(&mut conn, "B");
        let c = item(&mut conn, "C");
        let d = item(&mut conn, "D");

        // a splits into b and c, which meet again at d.
        link(&conn, &a, &b).unwrap();
        link(&conn, &a, &c).unwrap();
        link(&conn, &b, &d).unwrap();
        link(&conn, &c, &d).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 4);

        // Anything from d back to a closes it, by either route.
        assert!(link(&conn, &d, &a).is_err());
        assert!(link(&conn, &d, &b).is_err());
        assert_eq!(list(&conn).unwrap().len(), 4);
    }
}
