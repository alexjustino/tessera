//! The property repository: the fields a collection declares, and the values
//! its items fill in.
//!
//! The host stores values as JSON and does not interpret them. Which shapes are
//! legal for which type, what an empty value looks like, how two values compare
//! — all of that lives in `src/domain/property.ts`, where it is a pure function
//! with a round-trip test per type (ADR-003).
//!
//! That split is deliberate and worth defending: a second, partial
//! implementation of the type rules in Rust would be the kind of duplication
//! that agrees on the easy cases and disagrees on the ones that matter.
//!
//! What the host *does* enforce is what only it can: that a value belongs to a
//! property that exists, on an item that exists, and that a seeded property is
//! not deleted out from under the views that refer to it by key.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::Value;
use uuid::Uuid;

use super::items::now;
use super::models::{NewProperty, Property, PropertyValueRow};
use crate::error::{Error, Result};

const MAX_NAME: usize = 200;

fn read_property(row: &Row<'_>) -> rusqlite::Result<Property> {
    let config: String = row.get("config_json")?;
    Ok(Property {
        id: row.get("id")?,
        collection_id: row.get("collection_id")?,
        key: row.get("key")?,
        name: row.get("name")?,
        r#type: row.get("type")?,
        // A malformed config is read as empty rather than failing the whole
        // list: one bad row must not hide every other property.
        config: serde_json::from_str(&config).unwrap_or(Value::Object(Default::default())),
        position: row.get("position")?,
        is_system: row.get::<_, i64>("is_system")? != 0,
    })
}

fn clean_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::InvalidInput("a property needs a name"));
    }
    if trimmed.chars().count() > MAX_NAME {
        return Err(Error::InvalidInput("that property name is too long"));
    }
    Ok(trimmed.to_string())
}

/// Every property a collection declares, in order.
pub fn list_properties(conn: &Connection, collection_id: &str) -> Result<Vec<Property>> {
    let mut statement = conn.prepare(
        "SELECT id, collection_id, key, name, type, config_json, position, is_system
         FROM property
         WHERE collection_id = ?1
         ORDER BY position",
    )?;
    let rows = statement.query_map(params![collection_id], read_property)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_property(conn: &Connection, id: &str) -> Result<Property> {
    conn.query_row(
        "SELECT id, collection_id, key, name, type, config_json, position, is_system
         FROM property WHERE id = ?1",
        params![id],
        read_property,
    )
    .optional()?
    .ok_or(Error::NotFound)
}

/// Declare a new property on a collection.
///
/// The key is what code refers to and is derived from the name once, at
/// creation. It never changes afterwards: renaming a property must not break a
/// saved view that points at it.
pub fn create_property(conn: &Connection, new: NewProperty) -> Result<Property> {
    let name = clean_name(&new.name)?;
    let key = derive_key(&name);
    let id = Uuid::now_v7().to_string();

    let taken: i64 = conn.query_row(
        "SELECT count(*) FROM property WHERE collection_id = ?1 AND key = ?2",
        params![new.collection_id, key],
        |row| row.get(0),
    )?;
    if taken > 0 {
        return Err(Error::InvalidInput(
            "a property with that name already exists",
        ));
    }

    conn.execute(
        "INSERT INTO property (id, collection_id, key, name, type, config_json, position, is_system)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        params![
            id,
            new.collection_id,
            key,
            name,
            new.r#type,
            new.config.to_string(),
            new.position
        ],
    )?;

    get_property(conn, &id)
}

/// Rename a property, or change how it is configured.
///
/// The type is not changeable here. Changing a property's type would reinterpret
/// every value already stored under it, which is a data migration wearing an
/// edit's clothing — it needs its own design, not a field on this call.
pub fn update_property(
    conn: &Connection,
    id: &str,
    name: &str,
    config: &Value,
) -> Result<Property> {
    let name = clean_name(name)?;

    let changed = conn.execute(
        "UPDATE property SET name = ?2, config_json = ?3 WHERE id = ?1",
        params![id, name, config.to_string()],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }

    get_property(conn, id)
}

/// Delete a property and every value stored under it.
///
/// A seeded property is refused: views, the board and the interface refer to
/// those by key, and letting one disappear would break a screen rather than a
/// row.
pub fn delete_property(conn: &Connection, id: &str) -> Result<()> {
    let property = get_property(conn, id)?;
    if property.is_system {
        return Err(Error::InvalidInput(
            "that property is part of the list and cannot be deleted",
        ));
    }

    // `item_property_value` cascades on the foreign key, so the values go with it.
    conn.execute("DELETE FROM property WHERE id = ?1", params![id])?;
    Ok(())
}

/// Every value stored for the items of a collection.
///
/// Returned flat and joined in the interface rather than nested per item: the
/// query engine already holds the items, and a flat list is one round trip
/// instead of one per row.
pub fn list_values(conn: &Connection, collection_id: &str) -> Result<Vec<PropertyValueRow>> {
    let mut statement = conn.prepare(
        "SELECT v.item_id, v.property_id, v.value_json
         FROM item_property_value v
         JOIN item i ON i.id = v.item_id
         WHERE i.collection_id = ?1 AND i.archived_at IS NULL",
    )?;
    let rows = statement.query_map(params![collection_id], |row| {
        let raw: String = row.get("value_json")?;
        Ok(PropertyValueRow {
            item_id: row.get("item_id")?,
            property_id: row.get("property_id")?,
            value: serde_json::from_str(&raw).unwrap_or(Value::Null),
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Store a value, or clear it.
///
/// A null value deletes the row rather than storing `"null"`. An absent row and
/// a row containing nothing would otherwise be two ways of saying the same
/// thing, and every query would have to handle both.
pub fn set_value(conn: &Connection, item_id: &str, property_id: &str, value: &Value) -> Result<()> {
    // Both ends must exist. Without this the foreign key would catch it, but as
    // a database error rather than as a sentence.
    let item_exists: i64 = conn.query_row(
        "SELECT count(*) FROM item WHERE id = ?1",
        params![item_id],
        |r| r.get(0),
    )?;
    if item_exists == 0 {
        return Err(Error::NotFound);
    }
    get_property(conn, property_id)?;

    if value.is_null() {
        conn.execute(
            "DELETE FROM item_property_value WHERE item_id = ?1 AND property_id = ?2",
            params![item_id, property_id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO item_property_value (item_id, property_id, value_json)
             VALUES (?1, ?2, ?3)
             ON CONFLICT (item_id, property_id) DO UPDATE SET value_json = excluded.value_json",
            params![item_id, property_id, value.to_string()],
        )?;
    }

    conn.execute(
        "UPDATE item SET updated_at = ?2 WHERE id = ?1",
        params![item_id, now()],
    )?;

    Ok(())
}

/// A stable key derived from a name: lower case, words joined by underscores.
fn derive_key(name: &str) -> String {
    let key: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();

    let trimmed = key.trim_matches('_').to_string();
    // Collapse the runs of underscores that punctuation leaves behind.
    let mut collapsed = String::with_capacity(trimmed.len());
    let mut previous_underscore = false;
    for c in trimmed.chars() {
        if c == '_' {
            if !previous_underscore {
                collapsed.push(c);
            }
            previous_underscore = true;
        } else {
            collapsed.push(c);
            previous_underscore = false;
        }
    }

    if collapsed.is_empty() {
        // A name made entirely of punctuation or non-Latin script still needs a
        // key. Falling back to a generated one keeps the name intact.
        return format!("field_{}", Uuid::now_v7().simple());
    }
    collapsed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items::create_item;
    use crate::db::migrations;
    use crate::db::models::NewItem;
    use serde_json::json;

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

    fn a_property(conn: &Connection, name: &str, kind: &str) -> Property {
        create_property(
            conn,
            NewProperty {
                collection_id: "tasks".into(),
                name: name.into(),
                r#type: kind.into(),
                config: json!({}),
                position: "b".into(),
            },
        )
        .expect("create property")
    }

    #[test]
    fn the_default_list_arrives_with_status_and_priority() {
        let conn = workspace();
        let properties = list_properties(&conn, "tasks").expect("list");

        let keys: Vec<_> = properties.iter().map(|p| p.key.as_str()).collect();
        assert_eq!(keys, ["status", "priority"]);
        assert!(properties.iter().all(|p| p.is_system));
    }

    #[test]
    fn the_seeded_status_carries_its_options() {
        let conn = workspace();
        let status = get_property(&conn, "tasks.status").expect("status");

        let options = status.config["options"].as_array().expect("options");
        assert_eq!(options.len(), 4);
        assert_eq!(options[0]["id"], "todo");
        assert_eq!(options[3]["group"], "done");
    }

    #[test]
    fn the_speculative_status_column_is_gone() {
        // Migration 003 retracts it. If it comes back, something re-ran 001 on
        // top of a migrated database, which would be a much larger problem.
        let conn = workspace();
        let columns: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('item')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();

        assert!(!columns.contains(&"status_id".to_string()));
        assert!(columns.contains(&"title".to_string()));
    }

    #[test]
    fn creating_derives_a_stable_key_from_the_name() {
        let conn = workspace();
        assert_eq!(
            a_property(&conn, "Estimated effort", "duration").key,
            "estimated_effort"
        );
    }

    #[test]
    fn a_key_survives_punctuation_without_becoming_a_row_of_underscores() {
        let conn = workspace();
        assert_eq!(
            a_property(&conn, "Client / Account (v2)", "text").key,
            "client_account_v2"
        );
    }

    #[test]
    fn a_name_with_no_latin_characters_still_gets_a_key() {
        let conn = workspace();
        let property = a_property(&conn, "予算", "number");
        assert!(
            !property.key.is_empty(),
            "a property was created with no key"
        );
        assert_eq!(property.name, "予算", "the name must be kept intact");
    }

    #[test]
    fn renaming_keeps_the_key_so_a_saved_view_still_points_at_it() {
        let conn = workspace();
        let property = a_property(&conn, "Owner", "text");

        let renamed =
            update_property(&conn, &property.id, "Responsible", &json!({})).expect("rename");

        assert_eq!(renamed.name, "Responsible");
        assert_eq!(renamed.key, "owner", "the key changed under a saved view");
    }

    #[test]
    fn values_round_trip_through_the_store_untouched() {
        // The host does not interpret values. Whatever JSON the domain layer
        // wrote must come back byte-identical in meaning.
        let mut conn = workspace();
        let item = an_item(&mut conn);

        let samples = [
            json!("some text"),
            json!(42),
            json!(3.5),
            json!(true),
            json!(false),
            json!(["a", "b"]),
            json!("2026-09-02"),
        ];

        let property = a_property(&conn, "Anything", "text");
        for sample in samples {
            set_value(&conn, &item, &property.id, &sample).expect("set");
            let values = list_values(&conn, "tasks").expect("list");
            let stored = values
                .iter()
                .find(|v| v.property_id == property.id)
                .expect("the value was not stored");
            assert_eq!(stored.value, sample);
        }
    }

    #[test]
    fn a_null_value_clears_the_row_rather_than_storing_nothing() {
        // An absent row and a row containing null would be two ways of saying
        // the same thing, and every query would have to handle both.
        let mut conn = workspace();
        let item = an_item(&mut conn);
        let property = a_property(&conn, "Note", "text");

        set_value(&conn, &item, &property.id, &json!("something")).expect("set");
        assert_eq!(list_values(&conn, "tasks").expect("list").len(), 1);

        set_value(&conn, &item, &property.id, &Value::Null).expect("clear");
        assert!(list_values(&conn, "tasks").expect("list").is_empty());
    }

    #[test]
    fn setting_a_value_twice_updates_rather_than_duplicating() {
        let mut conn = workspace();
        let item = an_item(&mut conn);
        let property = a_property(&conn, "Note", "text");

        set_value(&conn, &item, &property.id, &json!("first")).expect("set");
        set_value(&conn, &item, &property.id, &json!("second")).expect("set again");

        let values = list_values(&conn, "tasks").expect("list");
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].value, json!("second"));
    }

    #[test]
    fn deleting_a_property_takes_its_values_with_it() {
        let mut conn = workspace();
        let item = an_item(&mut conn);
        let property = a_property(&conn, "Temporary", "text");
        set_value(&conn, &item, &property.id, &json!("x")).expect("set");

        delete_property(&conn, &property.id).expect("delete");

        assert!(list_values(&conn, "tasks").expect("list").is_empty());
        assert!(matches!(
            get_property(&conn, &property.id),
            Err(Error::NotFound)
        ));
    }

    #[test]
    fn deleting_an_item_takes_its_values_with_it() {
        let mut conn = workspace();
        let item = an_item(&mut conn);
        let property = a_property(&conn, "Note", "text");
        set_value(&conn, &item, &property.id, &json!("x")).expect("set");

        crate::db::items::delete_item(&mut conn, &item).expect("delete item");

        assert!(list_values(&conn, "tasks").expect("list").is_empty());
    }

    // ── Negative cases ──────────────────────────────────────────────────────

    #[test]
    fn refuses_to_delete_a_seeded_property() {
        let conn = workspace();
        let result = delete_property(&conn, "tasks.status");

        assert!(matches!(result, Err(Error::InvalidInput(_))));
        assert!(get_property(&conn, "tasks.status").is_ok());
    }

    #[test]
    fn refuses_two_properties_with_the_same_name() {
        let conn = workspace();
        a_property(&conn, "Owner", "text");

        let again = create_property(
            &conn,
            NewProperty {
                collection_id: "tasks".into(),
                name: "owner".into(),
                r#type: "text".into(),
                config: json!({}),
                position: "c".into(),
            },
        );

        assert!(matches!(again, Err(Error::InvalidInput(_))));
    }

    #[test]
    fn refuses_an_empty_property_name() {
        let conn = workspace();
        for name in ["", "   "] {
            let result = create_property(
                &conn,
                NewProperty {
                    collection_id: "tasks".into(),
                    name: name.into(),
                    r#type: "text".into(),
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
    fn refuses_a_value_for_an_item_or_property_that_does_not_exist() {
        let mut conn = workspace();
        let item = an_item(&mut conn);
        let property = a_property(&conn, "Note", "text");

        assert!(matches!(
            set_value(&conn, "nope", &property.id, &json!("x")),
            Err(Error::NotFound)
        ));
        assert!(matches!(
            set_value(&conn, &item, "nope", &json!("x")),
            Err(Error::NotFound)
        ));
        assert!(list_values(&conn, "tasks").expect("list").is_empty());
    }

    #[test]
    fn reports_a_missing_property_rather_than_pretending() {
        let conn = workspace();
        assert!(matches!(get_property(&conn, "nope"), Err(Error::NotFound)));
        assert!(matches!(
            update_property(&conn, "nope", "x", &json!({})),
            Err(Error::NotFound)
        ));
        assert!(matches!(
            delete_property(&conn, "nope"),
            Err(Error::NotFound)
        ));
    }
}
