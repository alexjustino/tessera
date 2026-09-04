//! The view repository: a saved query, given a name and a shape.
//!
//! A view is filters, sorts, grouping and which fields to show, stored as JSON
//! the host does not interpret. Which of those are legal, and what running them
//! means, is the query engine's business in pure TypeScript (ADR-004). Storing
//! the query as an opaque document is what lets the engine grow — a new
//! operator is a new value in a JSON blob, not a migration.
//!
//! `collection_id` may be null. That is a cross-collection view: Today, Inbox,
//! Overdue. Technically the same query with no collection filter, which is why
//! it needs no second engine.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::Value;
use uuid::Uuid;

use super::models::{NewView, View};
use crate::error::{Error, Result};

const MAX_NAME: usize = 200;

/// The shapes a view can take. Rejected here rather than at read time, so a
/// value the interface cannot render never reaches the database.
const KINDS: [&str; 4] = ["list", "table", "board", "calendar"];

fn read_view(row: &Row<'_>) -> rusqlite::Result<View> {
    let config: String = row.get("config_json")?;
    Ok(View {
        id: row.get("id")?,
        collection_id: row.get("collection_id")?,
        name: row.get("name")?,
        kind: row.get("kind")?,
        // A malformed query reads as empty rather than failing the list: one
        // broken view must not hide every other one.
        config: serde_json::from_str(&config).unwrap_or(Value::Object(Default::default())),
        position: row.get("position")?,
    })
}

fn clean_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::InvalidInput("a view needs a name"));
    }
    if trimmed.chars().count() > MAX_NAME {
        return Err(Error::InvalidInput("that view name is too long"));
    }
    Ok(trimmed.to_string())
}

fn check_kind(kind: &str) -> Result<()> {
    if KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(Error::InvalidInput("that is not a kind of view"))
    }
}

/// Views on a collection, plus the cross-collection ones, in order.
pub fn list_views(conn: &Connection, collection_id: Option<&str>) -> Result<Vec<View>> {
    let mut statement = conn.prepare(
        "SELECT id, collection_id, name, kind, config_json, position
         FROM view
         WHERE collection_id IS ?1 OR collection_id IS NULL
         ORDER BY position",
    )?;
    let rows = statement.query_map(params![collection_id], read_view)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_view(conn: &Connection, id: &str) -> Result<View> {
    conn.query_row(
        "SELECT id, collection_id, name, kind, config_json, position
         FROM view WHERE id = ?1",
        params![id],
        read_view,
    )
    .optional()?
    .ok_or(Error::NotFound)
}

pub fn create_view(conn: &Connection, new: NewView) -> Result<View> {
    let name = clean_name(&new.name)?;
    check_kind(&new.kind)?;

    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO view (id, collection_id, name, kind, config_json, position)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            new.collection_id,
            name,
            new.kind,
            new.config.to_string(),
            new.position
        ],
    )?;

    get_view(conn, &id)
}

/// Rename a view, change its kind, or save a different query into it.
///
/// The kind *is* changeable, unlike a property's type: a view holds no data of
/// its own, so showing the same query as a table instead of a list reinterprets
/// nothing.
pub fn update_view(
    conn: &Connection,
    id: &str,
    name: &str,
    kind: &str,
    config: &Value,
) -> Result<View> {
    let name = clean_name(name)?;
    check_kind(kind)?;

    let changed = conn.execute(
        "UPDATE view SET name = ?2, kind = ?3, config_json = ?4 WHERE id = ?1",
        params![id, name, kind, config.to_string()],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }

    get_view(conn, id)
}

pub fn delete_view(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute("DELETE FROM view WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use serde_json::json;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    fn a_view(conn: &Connection, name: &str, kind: &str, collection: Option<&str>) -> View {
        create_view(
            conn,
            NewView {
                collection_id: collection.map(str::to_string),
                name: name.into(),
                kind: kind.into(),
                config: json!({ "filters": [], "sorts": [] }),
                position: "V".into(),
            },
        )
        .expect("create view")
    }

    #[test]
    fn a_new_workspace_starts_with_its_views_in_a_deliberate_order() {
        let conn = workspace();
        let views = list_views(&conn, Some("tasks")).expect("list");

        let names: Vec<_> = views.iter().map(|view| view.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "List",
                "Table",
                "Board",
                "Today",
                "Overdue",
                "Next 7 days",
                "Calendar"
            ]
        );
    }

    #[test]
    fn the_seeded_board_groups_by_status_and_carries_its_own_settings() {
        let conn = workspace();
        let board = get_view(&conn, "tasks.board").expect("board");

        assert_eq!(board.config["groupBy"]["propertyId"], "tasks.status");
        assert!(board.config["board"]["wipLimits"].is_object());
        assert_eq!(board.config["board"]["cardProperties"][0], "tasks.priority");
    }

    #[test]
    fn seeding_the_default_views_is_idempotent() {
        let conn = workspace();
        migrations::apply(&conn).expect("re-apply");
        assert_eq!(list_views(&conn, Some("tasks")).expect("list").len(), 7);
    }

    #[test]
    fn the_query_round_trips_untouched() {
        // The host stores the query and does not interpret it. Whatever the
        // engine wrote must come back meaning the same thing.
        let conn = workspace();
        let query = json!({
            "filters": [{ "id": "f1", "field": { "kind": "property", "propertyId": "p1" },
                          "operator": "is", "value": "doing" }],
            "match": "all",
            "sorts": [{ "field": { "kind": "builtin", "field": "title" }, "direction": "desc" }],
            "groupBy": null,
            "includeCompleted": false
        });

        let view = create_view(
            &conn,
            NewView {
                collection_id: Some("tasks".into()),
                name: "In progress".into(),
                kind: "list".into(),
                config: query.clone(),
                position: "b".into(),
            },
        )
        .expect("create");

        assert_eq!(get_view(&conn, &view.id).expect("read").config, query);
    }

    #[test]
    fn a_cross_collection_view_appears_for_every_collection() {
        // Today, Inbox and Overdue belong to no collection. They are the same
        // engine with no collection filter, which is why they need no second one.
        let conn = workspace();

        let names: Vec<_> = list_views(&conn, Some("tasks"))
            .expect("list")
            .into_iter()
            .map(|view| view.name)
            .collect();
        assert!(names.contains(&"Today".to_string()));

        // The cross-collection views follow every collection, because they
        // belong to none.
        let elsewhere: Vec<_> = list_views(&conn, Some("something-else"))
            .expect("list")
            .into_iter()
            .map(|view| view.name)
            .collect();
        assert!(elsewhere.contains(&"Today".to_string()));
    }

    #[test]
    fn a_views_kind_is_changeable_unlike_a_propertys_type() {
        // A view holds no data of its own, so showing the same query as a table
        // instead of a list reinterprets nothing.
        let conn = workspace();
        let view = a_view(&conn, "Everything", "list", Some("tasks"));

        let changed =
            update_view(&conn, &view.id, "Everything", "table", &view.config).expect("update");

        assert_eq!(changed.kind, "table");
    }

    #[test]
    fn deleting_a_collection_takes_its_views_with_it() {
        let conn = workspace();
        let view = a_view(&conn, "Doomed", "list", Some("tasks"));

        conn.execute("DELETE FROM collection WHERE id = 'tasks'", [])
            .expect("delete collection");

        assert!(matches!(get_view(&conn, &view.id), Err(Error::NotFound)));
    }

    #[test]
    fn a_malformed_query_reads_as_empty_rather_than_hiding_every_view() {
        let conn = workspace();
        let view = a_view(&conn, "Broken", "list", Some("tasks"));
        conn.execute(
            "UPDATE view SET config_json = 'not json at all' WHERE id = ?1",
            params![view.id],
        )
        .expect("corrupt");

        let views = list_views(&conn, Some("tasks")).expect("list");
        let broken = views
            .iter()
            .find(|v| v.id == view.id)
            .expect("still listed");
        assert!(broken.config.is_object());
    }

    // ── Negative cases ──────────────────────────────────────────────────────

    #[test]
    fn refuses_a_kind_the_interface_cannot_render() {
        let conn = workspace();
        let result = create_view(
            &conn,
            NewView {
                collection_id: Some("tasks".into()),
                name: "Gantt".into(),
                kind: "timeline".into(),
                config: json!({}),
                position: "c".into(),
            },
        );
        assert!(matches!(result, Err(Error::InvalidInput(_))));
    }

    #[test]
    fn refuses_an_empty_name() {
        let conn = workspace();
        for name in ["", "   "] {
            let result = create_view(
                &conn,
                NewView {
                    collection_id: Some("tasks".into()),
                    name: name.into(),
                    kind: "list".into(),
                    config: json!({}),
                    position: "c".into(),
                },
            );
            assert!(
                matches!(result, Err(Error::InvalidInput(_))),
                "accepted {name:?}"
            );
        }
    }

    #[test]
    fn reports_a_missing_view_rather_than_pretending() {
        let conn = workspace();
        assert!(matches!(get_view(&conn, "nope"), Err(Error::NotFound)));
        assert!(matches!(
            update_view(&conn, "nope", "x", "list", &json!({})),
            Err(Error::NotFound)
        ));
        assert!(matches!(delete_view(&conn, "nope"), Err(Error::NotFound)));
    }
}
