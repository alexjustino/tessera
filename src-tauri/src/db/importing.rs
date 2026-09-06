//! The import door, host side: apply a plan in one transaction and write down
//! what it created, so the whole import can be taken back as one thing.
//!
//! The plan arrives already decided — the domain layer previewed it and the
//! person chose what to skip. This module does not judge duplicates; it makes
//! rows, records them, and can unmake exactly those.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::calendar;
use super::items::{self, now};
use super::models::{NewEvent, NewItem};
use crate::error::{Error, Result};

// ── What arrives ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct PlannedCollection {
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    /// Where a created collection goes in the rail. Decided by the caller.
    pub position: String,
}

/// A block for a task's document: the editor's node JSON, typed, placed.
#[derive(Debug, Clone, Deserialize)]
pub struct PlannedBlock {
    #[serde(rename = "type")]
    pub kind: String,
    pub content: serde_json::Value,
    pub position: String,
}

/// A property the tasks' values need: created if absent, its options extended
/// if present. Options are the domain's shape, stored as given.
#[derive(Debug, Clone, Deserialize)]
pub struct PlannedProperty {
    pub collection: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub options: Vec<serde_json::Value>,
    /// Where a created property sits among the collection's. Caller's.
    pub position: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlannedTask {
    pub collection: String,
    pub title: String,
    pub notes: Option<String>,
    /// Decided by the caller, which knows the collection's current order.
    pub position: String,
    pub start_at: Option<String>,
    pub due_at: Option<String>,
    pub completed_at: Option<String>,
    pub estimate_minutes: Option<i64>,
    pub is_milestone: bool,
    /// Property values by property *name*, as the source called them.
    pub values: HashMap<String, serde_json::Value>,
    /// Blocks for the document, after the notes paragraph.
    #[serde(default)]
    pub blocks: Vec<PlannedBlock>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlannedEvent {
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub tz: String,
    pub all_day: bool,
    pub rrule: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Plan {
    pub source: String,
    pub collections: Vec<PlannedCollection>,
    pub tasks: Vec<PlannedTask>,
    pub events: Vec<PlannedEvent>,
    #[serde(default)]
    pub properties: Vec<PlannedProperty>,
}

// ── What is kept ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Summary {
    pub collections: i64,
    pub tasks: i64,
    pub events: i64,
    pub notes: i64,
    /// Values whose property the target collection does not have.
    pub values_dropped: i64,
    /// Properties created, and existing ones whose options were extended.
    #[serde(default)]
    pub properties_created: i64,
    #[serde(default)]
    pub properties_extended: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Batch {
    pub id: String,
    pub source: String,
    pub imported_at: String,
    pub summary: Summary,
}

fn read_batch(row: &rusqlite::Row<'_>) -> rusqlite::Result<Batch> {
    let summary_json: String = row.get(3)?;
    Ok(Batch {
        id: row.get(0)?,
        source: row.get(1)?,
        imported_at: row.get(2)?,
        summary: serde_json::from_str(&summary_json).unwrap_or_default(),
    })
}

/// Every import, newest first.
pub fn list(conn: &Connection) -> Result<Vec<Batch>> {
    let mut statement = conn.prepare(
        "SELECT id, source, imported_at, summary_json FROM import_batch ORDER BY imported_at DESC",
    )?;
    let rows = statement.query_map([], read_batch)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ── Applying ───────────────────────────────────────────────────────────────

struct Recorder<'a> {
    transaction: &'a Transaction<'a>,
    batch_id: String,
    seq: i64,
}

impl Recorder<'_> {
    fn record(&mut self, table: &str, id: &str) -> Result<()> {
        self.record_with(table, id, None)
    }

    /// A row that was changed rather than made: what it was, for undo.
    fn record_with(&mut self, table: &str, id: &str, before: Option<&str>) -> Result<()> {
        self.seq += 1;
        self.transaction.execute(
            "INSERT INTO import_row (batch_id, seq, table_name, row_id, before_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![self.batch_id, self.seq, table, id, before],
        )?;
        Ok(())
    }
}

/// Make every row the plan asks for, or none, and remember each one.
pub fn apply(conn: &mut Connection, plan: &Plan) -> Result<Batch> {
    if plan.source.trim().is_empty() {
        return Err(Error::InvalidInput(
            "an import needs to say where it came from",
        ));
    }
    let batch_id = Uuid::now_v7().to_string();
    let timestamp = now();

    let transaction = conn.transaction()?;
    transaction.execute(
        "INSERT INTO import_batch (id, source, imported_at, summary_json) VALUES (?1, ?2, ?3, '{}')",
        params![batch_id, plan.source.trim(), timestamp],
    )?;
    let mut recorder = Recorder {
        transaction: &transaction,
        batch_id: batch_id.clone(),
        seq: 0,
    };
    let mut summary = Summary::default();

    // Collections: reuse by name, whatever the case; create the rest.
    let mut collection_ids: HashMap<String, String> = HashMap::new();
    for collection in &plan.collections {
        let key = collection.name.trim().to_lowercase();
        if collection_ids.contains_key(&key) {
            continue;
        }
        let existing: Option<String> = transaction
            .query_row(
                "SELECT id FROM collection WHERE archived_at IS NULL AND lower(trim(name)) = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        let id = match existing {
            Some(id) => id,
            None => {
                let id = Uuid::now_v7().to_string();
                transaction.execute(
                    "INSERT INTO collection (id, name, icon, color, position, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                    params![
                        id,
                        collection.name.trim(),
                        collection.icon,
                        collection.color,
                        collection.position,
                        timestamp
                    ],
                )?;
                recorder.record("collection", &id)?;
                summary.collections += 1;
                id
            }
        };
        collection_ids.insert(key, id);
    }

    // Properties the values need: created, or their options extended — with
    // the configuration as it was written down, so undo can put it back.
    for property in &plan.properties {
        let Some(collection_id) = collection_ids.get(&property.collection.trim().to_lowercase())
        else {
            return Err(Error::InvalidInput(
                "a property names a collection the plan does not describe",
            ));
        };
        if !matches!(property.kind.as_str(), "select" | "multi_select" | "status") {
            return Err(Error::InvalidInput(
                "an import can only add choice properties",
            ));
        }
        let existing: Option<(String, String, String)> = transaction
            .query_row(
                "SELECT id, type, config_json FROM property
                 WHERE collection_id = ?1 AND lower(trim(name)) = ?2",
                params![collection_id, property.name.trim().to_lowercase()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        match existing {
            None => {
                let created = super::properties::create_property(
                    &transaction,
                    super::models::NewProperty {
                        collection_id: collection_id.clone(),
                        name: property.name.trim().to_string(),
                        r#type: property.kind.clone(),
                        config: serde_json::json!({ "options": property.options }),
                        position: property.position.clone(),
                    },
                )?;
                recorder.record("property", &created.id)?;
                summary.properties_created += 1;
            }
            Some((id, kind, config_json)) => {
                if kind != property.kind {
                    return Err(Error::InvalidInput(
                        "a property of that name exists with a different type",
                    ));
                }
                let mut config: serde_json::Value =
                    serde_json::from_str(&config_json).unwrap_or(serde_json::json!({}));
                let have: Vec<String> = config["options"]
                    .as_array()
                    .map(|options| {
                        options
                            .iter()
                            .filter_map(|o| o["id"].as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                let missing: Vec<serde_json::Value> = property
                    .options
                    .iter()
                    .filter(|o| {
                        o["id"]
                            .as_str()
                            .is_some_and(|id| !have.iter().any(|h| h == id))
                    })
                    .cloned()
                    .collect();
                if !missing.is_empty() {
                    if !config["options"].is_array() {
                        config["options"] = serde_json::json!([]);
                    }
                    if let Some(options) = config["options"].as_array_mut() {
                        options.extend(missing);
                    }
                    transaction.execute(
                        "UPDATE property SET config_json = ?2 WHERE id = ?1",
                        params![id, config.to_string()],
                    )?;
                    recorder.record_with("property", &id, Some(&config_json))?;
                    summary.properties_extended += 1;
                }
            }
        }
    }

    // Tasks, with their dates, values and notes.
    for task in &plan.tasks {
        let Some(collection_id) = collection_ids.get(&task.collection.trim().to_lowercase()) else {
            return Err(Error::InvalidInput(
                "a task names a collection the plan does not describe",
            ));
        };
        if task.estimate_minutes.is_some_and(|m| m < 0) {
            return Err(Error::InvalidInput("an estimate cannot be negative"));
        }
        let id = items::insert_item(
            &transaction,
            &NewItem {
                collection_id: collection_id.clone(),
                title: task.title.clone(),
                position: task.position.clone(),
            },
        )?;
        transaction.execute(
            "UPDATE item SET start_at = ?2, due_at = ?3, completed_at = ?4, estimate_minutes = ?5,
                             is_milestone = ?6, updated_at = ?7
             WHERE id = ?1",
            params![
                id,
                task.start_at,
                task.due_at,
                task.completed_at,
                task.estimate_minutes,
                task.is_milestone as i64,
                timestamp
            ],
        )?;
        recorder.record("item", &id)?;
        summary.tasks += 1;

        for (name, value) in &task.values {
            let property_id: Option<String> = transaction
                .query_row(
                    "SELECT id FROM property WHERE collection_id = ?1 AND lower(trim(name)) = ?2",
                    params![collection_id, name.trim().to_lowercase()],
                    |row| row.get(0),
                )
                .optional()?;
            match property_id {
                Some(property_id) if !value.is_null() => {
                    transaction.execute(
                        "INSERT INTO item_property_value (item_id, property_id, value_json)
                         VALUES (?1, ?2, ?3)",
                        params![id, property_id, value.to_string()],
                    )?;
                }
                Some(_) => {}
                None => summary.values_dropped += 1,
            }
        }

        if let Some(notes) = task
            .notes
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
        {
            let block_id = Uuid::now_v7().to_string();
            let content = serde_json::json!({
                "type": "paragraph",
                "content": [{ "type": "text", "text": notes }]
            });
            transaction.execute(
                "INSERT INTO block (id, owner_kind, owner_id, parent_block_id, type, position,
                                    content_json, created_at, updated_at)
                 VALUES (?1, 'item', ?2, NULL, 'paragraph', 'a', ?3, ?4, ?4)",
                params![block_id, id, content.to_string(), timestamp],
            )?;
            // The index row the item already has carries its title; the note
            // joins it so search finds imported text too.
            transaction.execute(
                "UPDATE search_fts SET body = ?2 WHERE owner_kind = 'item' AND owner_id = ?1",
                params![id, notes],
            )?;
            recorder.record("block", &block_id)?;
            summary.notes += 1;
        }

        for block in &task.blocks {
            let block_id = Uuid::now_v7().to_string();
            transaction.execute(
                "INSERT INTO block (id, owner_kind, owner_id, parent_block_id, type, position,
                                    content_json, created_at, updated_at)
                 VALUES (?1, 'item', ?2, NULL, ?3, ?4, ?5, ?6, ?6)",
                params![
                    block_id,
                    id,
                    block.kind,
                    block.position,
                    block.content.to_string(),
                    timestamp
                ],
            )?;
            recorder.record("block", &block_id)?;
        }
    }

    // Events, on the first calendar.
    if !plan.events.is_empty() {
        let calendar_id: String = transaction
            .query_row(
                "SELECT id FROM calendar ORDER BY position LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?
            .ok_or(Error::InvalidInput(
                "there is no calendar to import events into",
            ))?;
        for event in &plan.events {
            let created = calendar::create_event(
                &transaction,
                NewEvent {
                    calendar_id: calendar_id.clone(),
                    title: event.title.clone(),
                    location: None,
                    starts_at_utc: event.starts_at.clone(),
                    ends_at_utc: event.ends_at.clone(),
                    tz: event.tz.clone(),
                    all_day: event.all_day,
                    rrule: event.rrule.clone(),
                },
            )?;
            recorder.record("event", &created.id)?;
            summary.events += 1;
        }
    }

    let rows_made = recorder.seq;

    drop(recorder);

    transaction.execute(
        "UPDATE import_batch SET summary_json = ?2 WHERE id = ?1",
        params![
            batch_id,
            serde_json::to_string(&summary).unwrap_or_default()
        ],
    )?;
    transaction.commit()?;
    log::info!("import applied: {rows_made} rows from {}", plan.source);

    Ok(Batch {
        id: batch_id,
        source: plan.source.trim().to_string(),
        imported_at: timestamp,
        summary,
    })
}

// ── Undoing ────────────────────────────────────────────────────────────────

/// Remove exactly what a batch created, newest row first, or nothing.
///
/// A collection the import created is removed only if everything in it came
/// from this import; a task the person added there since is theirs, and the
/// undo says so rather than taking it. A row already deleted by hand is not
/// an error: undo finds nothing to remove and moves on.
pub fn undo(conn: &mut Connection, batch_id: &str) -> Result<Batch> {
    let batch = conn
        .query_row(
            "SELECT id, source, imported_at, summary_json FROM import_batch WHERE id = ?1",
            params![batch_id],
            read_batch,
        )
        .optional()?
        .ok_or(Error::NotFound)?;

    let rows: Vec<(String, String, Option<String>)> = {
        let mut statement = conn.prepare(
            "SELECT table_name, row_id, before_json FROM import_row
             WHERE batch_id = ?1 ORDER BY seq DESC",
        )?;
        let found = statement.query_map(params![batch_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
        found.collect::<rusqlite::Result<Vec<_>>>()?
    };

    // Refuse before touching anything: a created collection that now holds
    // rows this import did not make.
    let imported_items: std::collections::HashSet<&str> = rows
        .iter()
        .filter(|(table, _, _)| table == "item")
        .map(|(_, id, _)| id.as_str())
        .collect();
    for (table, id, _) in &rows {
        if table != "collection" {
            continue;
        }
        let mut statement = conn.prepare("SELECT id FROM item WHERE collection_id = ?1")?;
        let others = statement
            .query_map(params![id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if others
            .iter()
            .any(|other| !imported_items.contains(other.as_str()))
        {
            return Err(Error::InvalidInput(
                "a collection this import created now holds tasks that were not imported; move them first",
            ));
        }
    }

    let transaction = conn.transaction()?;
    for (table, id, before) in &rows {
        match table.as_str() {
            // A property the import made goes; one it extended goes back to
            // what it was, values under the added options having left with the
            // imported items.
            "property" => match before {
                Some(config_json) => {
                    transaction.execute(
                        "UPDATE property SET config_json = ?2 WHERE id = ?1",
                        params![id, config_json],
                    )?;
                }
                None => {
                    transaction.execute(
                        "DELETE FROM item_property_value WHERE property_id = ?1",
                        params![id],
                    )?;
                    transaction.execute("DELETE FROM property WHERE id = ?1", params![id])?;
                }
            },
            "block" => {
                transaction.execute("DELETE FROM block WHERE id = ?1", params![id])?;
            }
            "item" => {
                transaction.execute(
                    "DELETE FROM block WHERE owner_kind = 'item' AND owner_id = ?1",
                    params![id],
                )?;
                transaction.execute(
                    "DELETE FROM search_fts WHERE owner_kind = 'item' AND owner_id = ?1",
                    params![id],
                )?;
                transaction.execute("DELETE FROM item WHERE id = ?1", params![id])?;
            }
            "event" => {
                transaction.execute(
                    "DELETE FROM search_fts WHERE owner_kind = 'event' AND owner_id = ?1",
                    params![id],
                )?;
                transaction.execute("DELETE FROM event WHERE id = ?1", params![id])?;
            }
            "collection" => {
                transaction.execute("DELETE FROM collection WHERE id = ?1", params![id])?;
            }
            _ => {}
        }
    }
    transaction.execute("DELETE FROM import_batch WHERE id = ?1", params![batch_id])?;
    transaction.commit()?;
    log::info!("import undone: {} rows from {}", rows.len(), batch.source);
    Ok(batch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::export;
    use crate::db::migrations;
    use crate::db::models::NewItem;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).unwrap();
        conn
    }

    fn task(collection: &str, title: &str, position: &str) -> PlannedTask {
        PlannedTask {
            collection: collection.into(),
            title: title.into(),
            notes: None,
            position: position.into(),
            start_at: None,
            due_at: None,
            completed_at: None,
            estimate_minutes: None,
            is_milestone: false,
            values: HashMap::new(),
            blocks: Vec::new(),
        }
    }

    fn plan() -> Plan {
        let mut brief = task("Tasks", "Write the brief", "m");
        brief.due_at = Some("2026-09-10T17:00:00.000Z".into());
        brief.estimate_minutes = Some(120);
        brief.notes = Some("Ask Ana.".into());
        brief
            .values
            .insert("Priority".into(), serde_json::json!("high"));
        brief
            .values
            .insert("Nonexistent".into(), serde_json::json!(1));
        Plan {
            source: "a test".into(),
            collections: vec![
                PlannedCollection {
                    name: "tasks".into(),
                    icon: None,
                    color: None,
                    position: "b".into(),
                },
                PlannedCollection {
                    name: "Errands".into(),
                    icon: None,
                    color: None,
                    position: "c".into(),
                },
            ],
            tasks: vec![brief, task("Errands", "Buy stamps", "a")],
            events: vec![PlannedEvent {
                title: "Dentist".into(),
                starts_at: "2026-09-16T14:00:00.000Z".into(),
                ends_at: "2026-09-16T15:00:00.000Z".into(),
                tz: "America/Sao_Paulo".into(),
                all_day: false,
                rrule: None,
            }],
            properties: Vec::new(),
        }
    }

    /// Everything but the import bookkeeping and the workspace stamp.
    fn snapshot(conn: &Connection) -> serde_json::Value {
        let mut document = export::export(conn).unwrap();
        document.tables.remove("import_batch");
        document.tables.remove("import_row");
        document.tables.remove("workspace");
        serde_json::to_value(document.tables).unwrap()
    }

    #[test]
    fn applying_makes_every_row_and_reuses_a_collection_by_name() {
        let mut conn = workspace();
        let batch = apply(&mut conn, &plan()).unwrap();

        assert_eq!(
            batch.summary,
            Summary {
                collections: 1,
                tasks: 2,
                events: 1,
                notes: 1,
                values_dropped: 1,
                ..Default::default()
            }
        );
        // "tasks" matched the seeded "Tasks"; only Errands was created.
        let collections: i64 = conn
            .query_row(
                "SELECT count(*) FROM collection WHERE archived_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(collections, 2);
        let in_tasks: i64 = conn
            .query_row(
                "SELECT count(*) FROM item WHERE collection_id = 'tasks'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(in_tasks, 1);
        let priority: String = conn
            .query_row(
                "SELECT v.value_json FROM item_property_value v JOIN item i ON i.id = v.item_id
                 WHERE i.title = 'Write the brief'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(priority, "\"high\"");
        let note: String = conn
            .query_row(
                "SELECT content_json FROM block WHERE type = 'paragraph'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(note.contains("Ask Ana."));
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn undo_puts_the_workspace_back_row_for_row() {
        let mut conn = workspace();
        items::create_item(
            &mut conn,
            NewItem {
                collection_id: "tasks".into(),
                title: "Mine already".into(),
                position: "a".into(),
            },
        )
        .unwrap();
        let before = snapshot(&conn);

        let batch = apply(&mut conn, &plan()).unwrap();
        assert_ne!(snapshot(&conn), before, "the import changed nothing");

        undo(&mut conn, &batch.id).unwrap();
        assert_eq!(snapshot(&conn), before);
        assert!(list(&conn).unwrap().is_empty());
        // Twice is not possible: the batch is gone.
        assert!(matches!(
            undo(&mut conn, &batch.id).unwrap_err(),
            Error::NotFound
        ));
    }

    #[test]
    fn undo_refuses_to_take_a_collection_that_now_holds_the_persons_own_tasks() {
        let mut conn = workspace();
        let batch = apply(&mut conn, &plan()).unwrap();
        let errands: String = conn
            .query_row(
                "SELECT id FROM collection WHERE name = 'Errands'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        items::create_item(
            &mut conn,
            NewItem {
                collection_id: errands,
                title: "Added by hand".into(),
                position: "z".into(),
            },
        )
        .unwrap();

        let refused = undo(&mut conn, &batch.id);
        assert!(matches!(refused.unwrap_err(), Error::InvalidInput(_)));
        // Nothing was removed.
        let count: i64 = conn
            .query_row("SELECT count(*) FROM item", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn a_row_deleted_by_hand_does_not_stop_the_undo() {
        let mut conn = workspace();
        let batch = apply(&mut conn, &plan()).unwrap();
        let stamps: String = conn
            .query_row("SELECT id FROM item WHERE title = 'Buy stamps'", [], |r| {
                r.get(0)
            })
            .unwrap();
        items::delete_item(&mut conn, &stamps).unwrap();

        undo(&mut conn, &batch.id).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM item", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    fn option(id: &str, label: &str) -> serde_json::Value {
        serde_json::json!({ "id": id, "label": label, "color": null })
    }

    fn status_config(conn: &Connection) -> String {
        conn.query_row(
            "SELECT config_json FROM property WHERE id = 'tasks.status'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_property_is_created_or_extended_and_undo_puts_it_back_exactly() {
        let mut conn = workspace();
        let before_status = status_config(&conn);
        let before = snapshot(&conn);

        let mut with_properties = plan();
        with_properties.properties = vec![
            PlannedProperty {
                collection: "Tasks".into(),
                name: "status".into(), // the seeded Status, whatever the case
                kind: "status".into(),
                options: vec![option("trello-review", "Review"), option("done", "Done")],
                position: "z".into(),
            },
            PlannedProperty {
                collection: "Tasks".into(),
                name: "Labels".into(),
                kind: "multi_select".into(),
                options: vec![option("design", "Design")],
                position: "z".into(),
            },
        ];
        with_properties.tasks[0]
            .values
            .insert("Status".into(), serde_json::json!("trello-review"));
        with_properties.tasks[0]
            .values
            .insert("Labels".into(), serde_json::json!(["design"]));

        let batch = apply(&mut conn, &with_properties).unwrap();
        assert_eq!(batch.summary.properties_created, 1);
        assert_eq!(batch.summary.properties_extended, 1);

        // Status gained exactly the option it lacked; Done was already there.
        let after_status = status_config(&conn);
        assert!(after_status.contains("trello-review"));
        // One Done: the seeded option, not a second one beside it.
        assert_eq!(after_status.matches("\"id\":\"done\"").count(), 1);
        let labels: i64 = conn
            .query_row(
                "SELECT count(*) FROM property WHERE collection_id = 'tasks' AND name = 'Labels'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(labels, 1);

        undo(&mut conn, &batch.id).unwrap();
        assert_eq!(status_config(&conn), before_status);
        assert_eq!(snapshot(&conn), before);
    }

    #[test]
    fn typed_blocks_are_written_in_order_and_removed_by_undo() {
        let mut conn = workspace();
        let mut with_blocks = plan();
        with_blocks.tasks[1].blocks = vec![
            PlannedBlock {
                kind: "heading".into(),
                content: serde_json::json!({
                    "type": "heading",
                    "attrs": { "level": 3 },
                    "content": [{ "type": "text", "text": "Directions" }]
                }),
                position: "a".into(),
            },
            PlannedBlock {
                kind: "taskList".into(),
                content: serde_json::json!({ "type": "taskList", "content": [] }),
                position: "b".into(),
            },
        ];
        let batch = apply(&mut conn, &with_blocks).unwrap();
        let kinds: Vec<String> = {
            let mut statement = conn
                .prepare(
                    "SELECT b.type FROM block b JOIN item i ON i.id = b.owner_id
                     WHERE i.title = 'Buy stamps' ORDER BY b.position",
                )
                .unwrap();
            statement
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(kinds, vec!["heading", "taskList"]);

        undo(&mut conn, &batch.id).unwrap();
        let left: i64 = conn
            .query_row("SELECT count(*) FROM block", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn a_failure_partway_leaves_nothing_behind() {
        let mut conn = workspace();
        let before = snapshot(&conn);
        let mut broken = plan();
        broken.tasks.push(task("Tasks", "   ", "q")); // an empty title is refused by insert_item

        assert!(apply(&mut conn, &broken).is_err());
        assert_eq!(snapshot(&conn), before);
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_task_in_a_collection_the_plan_does_not_name_is_refused() {
        let mut conn = workspace();
        let mut wrong = plan();
        wrong.tasks.push(task("Nowhere", "Lost", "a"));
        assert!(matches!(
            apply(&mut conn, &wrong).unwrap_err(),
            Error::InvalidInput(_)
        ));
        assert!(list(&conn).unwrap().is_empty());
    }
}
