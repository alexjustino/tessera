//! Lists (ADR-053): more than one place to keep tasks, each the same kind of place.
//!
//! A list is a `collection`. The table has been there since migration 001 and the
//! import door has written new ones since 1.2, but the screens only ever showed
//! `tasks`. A new list starts as a copy of how Tasks is set up: the same properties
//! (Status, Priority and whatever the person added), and the same views, with every
//! reference to a Tasks property rewritten to the new list's own. So a board groups
//! by the new list's Status, not by a column of another list.
//!
//! Tasks itself is the inbox: quick capture writes there, and it cannot be renamed
//! away or deleted. Deleting a list is refused while it holds anything, because a
//! collection takes its items with it (`ON DELETE CASCADE`): a press must not be able
//! to destroy work by deleting what looked like a heading.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use uuid::Uuid;

use super::items::{check_position, get_item, list_collections, now};
use super::models::{Collection, Item};
use crate::error::{Error, Result};

/// The list every workspace starts with, and where quick capture writes.
pub const INBOX: &str = "tasks";

const LONGEST_NAME: usize = 60;

fn clean_name(conn: &Connection, name: &str, except: Option<&str>) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::InvalidInput("a list needs a name"));
    }
    if name.chars().count() > LONGEST_NAME {
        return Err(Error::InvalidInput("that name is too long for a list"));
    }
    let taken = list_collections(conn)?.into_iter().any(|list| {
        Some(list.id.as_str()) != except && list.name.to_lowercase() == name.to_lowercase()
    });
    if taken {
        return Err(Error::InvalidInput(
            "there is already a list with that name",
        ));
    }
    Ok(name.to_owned())
}

fn get_list(conn: &Connection, id: &str) -> Result<Collection> {
    list_collections(conn)?
        .into_iter()
        .find(|list| list.id == id)
        .ok_or(Error::NotFound)
}

/// Every string in a view's configuration that names a Tasks property, renamed.
fn rewrite(value: &mut Value, ids: &HashMap<String, String>) {
    match value {
        Value::String(text) => {
            if let Some(new) = ids.get(text.as_str()) {
                *text = new.clone();
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|item| rewrite(item, ids)),
        Value::Object(map) => map.values_mut().for_each(|item| rewrite(item, ids)),
        _ => {}
    }
}

/// A new list, set up the way Tasks is.
pub fn create_list(conn: &mut Connection, name: &str, position: &str) -> Result<Collection> {
    check_position(position)?;
    let name = clean_name(conn, name, None)?;
    let id = Uuid::now_v7().to_string();
    let timestamp = now();

    let transaction = conn.transaction()?;
    transaction.execute(
        "INSERT INTO collection (id, name, icon, color, position, created_at, updated_at)
         VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?4)",
        params![id, name, position, timestamp],
    )?;

    let mut ids = HashMap::new();
    {
        let mut statement = transaction.prepare(
            "SELECT id, key, name, type, config_json, position, is_system
             FROM property WHERE collection_id = ?1 ORDER BY position",
        )?;
        let properties = statement
            .query_map(params![INBOX], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (old, key, property_name, kind, config, place, system) in properties {
            let new = Uuid::now_v7().to_string();
            transaction.execute(
                "INSERT INTO property (id, collection_id, key, name, type, config_json, position, is_system)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![new, id, key, property_name, kind, config, place, system],
            )?;
            ids.insert(old, new);
        }
    }

    {
        let mut statement = transaction.prepare(
            "SELECT name, kind, config_json, position FROM view
             WHERE collection_id = ?1 ORDER BY position",
        )?;
        let views = statement
            .query_map(params![INBOX], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (view_name, kind, config, place) in views {
            let mut parsed: Value = serde_json::from_str(&config).unwrap_or(Value::Null);
            rewrite(&mut parsed, &ids);
            transaction.execute(
                "INSERT INTO view (id, collection_id, name, kind, config_json, position)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    Uuid::now_v7().to_string(),
                    id,
                    view_name,
                    kind,
                    parsed.to_string(),
                    place
                ],
            )?;
        }
    }

    transaction.commit()?;
    get_list(conn, &id)
}

pub fn rename_list(conn: &Connection, id: &str, name: &str) -> Result<Collection> {
    get_list(conn, id)?;
    let name = clean_name(conn, name, Some(id))?;
    conn.execute(
        "UPDATE collection SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, now()],
    )?;
    get_list(conn, id)
}

/// Delete an empty list. Refused for the inbox, and for a list that holds anything.
pub fn delete_list(conn: &Connection, id: &str) -> Result<()> {
    if id == INBOX {
        return Err(Error::InvalidInput(
            "Tasks is where new tasks go, and stays",
        ));
    }
    get_list(conn, id)?;
    let held: i64 = conn.query_row(
        "SELECT count(*) FROM item WHERE collection_id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    if held > 0 {
        return Err(Error::InvalidInput(
            "that list still holds tasks; move or delete them first",
        ));
    }
    conn.execute("DELETE FROM collection WHERE id = ?1", params![id])?;
    Ok(())
}

/// Move a task, and its subtasks, to another list.
///
/// Its values go to the target's property with the same key and type, where there is
/// one; a value with nowhere to go is dropped, because a value on a property the
/// list does not have would be shown nowhere and counted nowhere.
pub fn move_to_list(
    conn: &mut Connection,
    id: &str,
    collection_id: &str,
    position: &str,
) -> Result<Item> {
    check_position(position)?;
    let item = get_item(conn, id)?;
    if item.parent_item_id.is_some() {
        return Err(Error::InvalidInput(
            "a subtask goes where its task goes; make it a task first",
        ));
    }
    get_list(conn, collection_id)?;
    if item.collection_id == collection_id {
        return Ok(item);
    }

    let transaction = conn.transaction()?;
    let timestamp = now();
    transaction.execute(
        "UPDATE item SET collection_id = ?2, position = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, collection_id, position, timestamp],
    )?;
    transaction.execute(
        "UPDATE item SET collection_id = ?2, updated_at = ?3 WHERE parent_item_id = ?1",
        params![id, collection_id, timestamp],
    )?;

    let values = {
        let mut statement = transaction.prepare(
            "SELECT v.property_id, p.key, p.type
             FROM item_property_value v JOIN property p ON p.id = v.property_id
             WHERE v.item_id = ?1",
        )?;
        let rows = statement
            .query_map(params![id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for (property_id, key, kind) in values {
        let target: Option<String> = transaction
            .query_row(
                "SELECT id FROM property WHERE collection_id = ?1 AND key = ?2 AND type = ?3",
                params![collection_id, key, kind],
                |row| row.get(0),
            )
            .optional()?;
        match target {
            Some(new) => transaction.execute(
                "UPDATE item_property_value SET property_id = ?3
                 WHERE item_id = ?1 AND property_id = ?2",
                params![id, property_id, new],
            )?,
            None => transaction.execute(
                "DELETE FROM item_property_value WHERE item_id = ?1 AND property_id = ?2",
                params![id, property_id],
            )?,
        };
    }

    transaction.commit()?;
    get_item(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items::{add_subtask, create_item, list_items, list_subtasks};
    use crate::db::migrations;
    use crate::db::models::NewItem;
    use crate::db::properties::{list_properties, list_values, set_value};
    use crate::db::views::list_views;
    use serde_json::json;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    fn task(conn: &mut Connection, collection: &str, title: &str) -> Item {
        create_item(
            conn,
            NewItem {
                collection_id: collection.into(),
                title: title.into(),
                position: "V".into(),
            },
        )
        .unwrap()
    }

    fn property(conn: &Connection, collection: &str, key: &str) -> String {
        list_properties(conn, collection)
            .unwrap()
            .into_iter()
            .find(|p| p.key == key)
            .unwrap()
            .id
    }

    #[test]
    fn a_new_list_has_the_properties_of_tasks_under_its_own_ids() {
        let mut conn = workspace();
        let list = create_list(&mut conn, "Work", "W").unwrap();

        let tasks = list_properties(&conn, INBOX).unwrap();
        let mine = list_properties(&conn, &list.id).unwrap();
        assert_eq!(
            tasks.iter().map(|p| &p.key).collect::<Vec<_>>(),
            mine.iter().map(|p| &p.key).collect::<Vec<_>>()
        );
        assert!(mine.iter().all(|p| tasks.iter().all(|t| t.id != p.id)));
        assert_eq!(list.name, "Work");
    }

    #[test]
    fn a_new_list_s_board_groups_by_its_own_status() {
        let mut conn = workspace();
        let list = create_list(&mut conn, "Work", "W").unwrap();
        let status = property(&conn, &list.id, "status");

        let board = list_views(&conn, Some(&list.id))
            .unwrap()
            .into_iter()
            .find(|v| v.collection_id.as_deref() == Some(list.id.as_str()) && v.kind == "board")
            .expect("a board");
        let config = board.config.to_string();
        assert!(config.contains(&status), "{config}");
        assert!(!config.contains("tasks.status"), "{config}");
    }

    #[test]
    fn renames_a_list() {
        let mut conn = workspace();
        let list = create_list(&mut conn, "Work", "W").unwrap();
        assert_eq!(
            rename_list(&conn, &list.id, " Office ").unwrap().name,
            "Office"
        );
    }

    #[test]
    fn deletes_an_empty_list_with_its_views_and_properties() {
        let mut conn = workspace();
        let list = create_list(&mut conn, "Work", "W").unwrap();
        delete_list(&conn, &list.id).unwrap();
        assert!(list_collections(&conn)
            .unwrap()
            .iter()
            .all(|l| l.id != list.id));
        assert!(list_properties(&conn, &list.id).unwrap().is_empty());
    }

    #[test]
    fn moving_a_task_carries_its_values_by_key_and_its_subtasks() {
        let mut conn = workspace();
        let list = create_list(&mut conn, "Work", "W").unwrap();
        let item = task(&mut conn, INBOX, "Report");
        add_subtask(&mut conn, &item.id, "Draft", "a").unwrap();
        set_value(&conn, &item.id, "tasks.status", &json!("doing")).unwrap();

        let moved = move_to_list(&mut conn, &item.id, &list.id, "V").unwrap();

        assert_eq!(moved.collection_id, list.id);
        assert_eq!(list_subtasks(&conn).unwrap()[0].collection_id, list.id);
        let values = list_values(&conn, &list.id).unwrap();
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].property_id, property(&conn, &list.id, "status"));
        assert_eq!(values[0].value, json!("doing"));
        assert!(list_items(&conn, Some(INBOX), true).unwrap().is_empty());
    }

    #[test]
    fn a_value_with_nowhere_to_go_is_dropped() {
        let mut conn = workspace();
        let list = create_list(&mut conn, "Work", "W").unwrap();
        // A property Tasks gained after the list was made.
        let extra = crate::db::properties::create_property(
            &conn,
            crate::db::models::NewProperty {
                collection_id: INBOX.into(),
                name: "Client".into(),
                r#type: "text".into(),
                config: json!({}),
                position: "z".into(),
            },
        )
        .unwrap();
        let item = task(&mut conn, INBOX, "Report");
        set_value(&conn, &item.id, &extra.id, &json!("Acme")).unwrap();

        move_to_list(&mut conn, &item.id, &list.id, "V").unwrap();

        assert!(list_values(&conn, &list.id).unwrap().is_empty());
    }

    // ── Negative cases ─────────────────────────────────────────────────────
    #[test]
    fn refuses_a_name_already_taken_whatever_its_case() {
        let mut conn = workspace();
        create_list(&mut conn, "Work", "W").unwrap();
        assert!(matches!(
            create_list(&mut conn, "work", "X"),
            Err(Error::InvalidInput(_))
        ));
        assert!(matches!(
            create_list(&mut conn, "TASKS", "X"),
            Err(Error::InvalidInput(_))
        ));
    }

    #[test]
    fn refuses_an_empty_or_long_name() {
        let mut conn = workspace();
        assert!(create_list(&mut conn, "   ", "W").is_err());
        assert!(create_list(&mut conn, &"x".repeat(61), "W").is_err());
        assert_eq!(list_collections(&conn).unwrap().len(), 1);
    }

    #[test]
    fn refuses_to_delete_tasks() {
        let conn = workspace();
        assert!(matches!(
            delete_list(&conn, INBOX),
            Err(Error::InvalidInput(_))
        ));
    }

    #[test]
    fn refuses_to_delete_a_list_that_holds_a_task_even_a_finished_one() {
        let mut conn = workspace();
        let list = create_list(&mut conn, "Work", "W").unwrap();
        let item = task(&mut conn, &list.id, "Report");
        crate::db::items::set_completed(&conn, &item.id, true).unwrap();

        assert!(matches!(
            delete_list(&conn, &list.id),
            Err(Error::InvalidInput(_))
        ));
        assert!(get_item(&conn, &item.id).is_ok());
    }

    #[test]
    fn refuses_to_move_to_a_list_that_does_not_exist() {
        let mut conn = workspace();
        let item = task(&mut conn, INBOX, "Report");
        assert!(matches!(
            move_to_list(&mut conn, &item.id, "nowhere", "V"),
            Err(Error::NotFound)
        ));
        assert_eq!(get_item(&conn, &item.id).unwrap().collection_id, INBOX);
    }

    #[test]
    fn refuses_to_move_a_subtask_on_its_own() {
        let mut conn = workspace();
        let list = create_list(&mut conn, "Work", "W").unwrap();
        let item = task(&mut conn, INBOX, "Report");
        let step = add_subtask(&mut conn, &item.id, "Draft", "a").unwrap();
        assert!(matches!(
            move_to_list(&mut conn, &step.id, &list.id, "V"),
            Err(Error::InvalidInput(_))
        ));
    }
}
