//! Export and import: the workspace as files a person owns outright.
//!
//! JSON is the complete, lossless form — every table, every row, every column,
//! read through the schema itself (`PRAGMA table_info`) so a migration cannot
//! leave a column behind. It is also the only form that imports. Markdown and
//! ICS are for other programs and other people: readable, standard, and
//! deliberately one-way.
//!
//! An import replaces the workspace; it never merges. Merging two histories of
//! the same identifiers is a synchronisation problem, and this product does not
//! pretend to have solved it. A safety backup is taken first, and the import is
//! one transaction that is checked for referential integrity before it commits.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::types::ValueRef;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::items::now;
use super::migrations;
use crate::error::{Error, Result};

pub const FORMAT: &str = "tessera-export";
pub const FORMAT_VERSION: i64 = 1;

/// Every table that holds data, in an order that satisfies the foreign keys
/// when inserted top to bottom. The search index is not here: it is derived,
/// and rebuilt after an import.
pub const TABLES: &[&str] = &[
    "workspace",
    "collection",
    "item",
    "property",
    "item_property_value",
    "tag",
    "item_tag",
    "item_dependency",
    "block",
    "view",
    "reminder",
    "activity",
    "calendar",
    "event",
    "event_exception",
    "time_block",
    "work_hours",
    "time_entry",
    "template",
];

/// The largest export file this build will read, so a wrong file cannot
/// exhaust memory before it is refused.
const MAX_IMPORT_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
pub struct Export {
    pub format: String,
    pub version: i64,
    pub schema_version: i64,
    pub exported_at: String,
    /// Table name → rows, each row column → value.
    pub tables: BTreeMap<String, Vec<Map<String, Value>>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Counts {
    pub items: i64,
    pub events: i64,
    pub blocks: i64,
}

pub fn counts(conn: &Connection) -> Result<Counts> {
    let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0));
    Ok(Counts {
        items: count("SELECT count(*) FROM item")?,
        events: count("SELECT count(*) FROM event")?,
        blocks: count("SELECT count(*) FROM block")?,
    })
}

fn columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(names)
}

fn to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => Value::from(n),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        // No table stores blobs; if one ever does, the bytes go out as numbers
        // rather than being dropped.
        ValueRef::Blob(b) => {
            Value::from(b.iter().map(|byte| Value::from(*byte)).collect::<Vec<_>>())
        }
    }
}

fn to_sql(value: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as Sql;
    match value {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => n
            .as_i64()
            .map(Sql::Integer)
            .or_else(|| n.as_f64().map(Sql::Real))
            .unwrap_or(Sql::Null),
        Value::String(s) => Sql::Text(s.clone()),
        Value::Array(bytes) => Sql::Blob(
            bytes
                .iter()
                .filter_map(|b| b.as_u64().map(|n| n as u8))
                .collect(),
        ),
        Value::Object(_) => Sql::Text(value.to_string()),
    }
}

/// The whole workspace as one document.
pub fn export(conn: &Connection) -> Result<Export> {
    let mut tables = BTreeMap::new();
    for table in TABLES {
        let names = columns(conn, table)?;
        let mut statement = conn.prepare(&format!("SELECT * FROM {table}"))?;
        let rows = statement.query_map([], |row| {
            let mut object = Map::new();
            for (index, name) in names.iter().enumerate() {
                object.insert(name.clone(), to_json(row.get_ref(index)?));
            }
            Ok(object)
        })?;
        tables.insert(
            table.to_string(),
            rows.collect::<rusqlite::Result<Vec<_>>>()?,
        );
    }
    Ok(Export {
        format: FORMAT.to_string(),
        version: FORMAT_VERSION,
        schema_version: migrations::current_version(conn),
        exported_at: now(),
        tables,
    })
}

pub fn export_to_file(conn: &Connection, path: &Path) -> Result<Counts> {
    let document = export(conn)?;
    let json = serde_json::to_string_pretty(&document).expect("export serialises");
    fs::write(path, json).map_err(|_| Error::InvalidInput("that file could not be written"))?;
    counts(conn)
}

/// Read and check an export file without touching the workspace.
pub fn read_export(path: &Path) -> Result<Export> {
    let size = fs::metadata(path)
        .map_err(|_| Error::InvalidInput("that file could not be opened"))?
        .len();
    if size > MAX_IMPORT_BYTES {
        return Err(Error::InvalidInput(
            "that file is too large to be an export",
        ));
    }
    let text =
        fs::read_to_string(path).map_err(|_| Error::InvalidInput("that file could not be read"))?;
    let document: Export = serde_json::from_str(&text)
        .map_err(|_| Error::InvalidInput("that file is not a Tessera export"))?;
    if document.format != FORMAT || document.version != FORMAT_VERSION {
        return Err(Error::InvalidInput("that file is not a Tessera export"));
    }
    if document.schema_version != migrations::target_version() {
        return Err(Error::InvalidInput(
            "that export comes from a different version of Tessera; restore a backup instead",
        ));
    }
    Ok(document)
}

/// Replace the workspace with the contents of an export. One transaction;
/// integrity is checked before it commits, and the search index is rebuilt.
pub fn import(conn: &mut Connection, document: &Export) -> Result<Counts> {
    // Rows arrive in an order that satisfies the keys, but only when every
    // table is complete; deleting in reverse then inserting forward under a
    // deferred check keeps the transaction honest without depending on order.
    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    let outcome = (|| -> Result<()> {
        let transaction = conn.transaction()?;
        for table in TABLES.iter().rev() {
            transaction.execute(&format!("DELETE FROM {table}"), [])?;
        }
        transaction.execute("DELETE FROM search_fts", [])?;

        for table in TABLES {
            let Some(rows) = document.tables.get(*table) else {
                continue;
            };
            let known = columns(&transaction, table)?;
            for row in rows {
                let names: Vec<&String> = row.keys().collect();
                for name in &names {
                    if !known.contains(name) {
                        return Err(Error::InvalidInput(
                            "that export does not match this schema",
                        ));
                    }
                }
                let placeholders: Vec<String> =
                    (1..=names.len()).map(|n| format!("?{n}")).collect();
                let sql = format!(
                    "INSERT INTO {table} ({}) VALUES ({})",
                    names
                        .iter()
                        .map(|n| n.as_str())
                        .collect::<Vec<_>>()
                        .join(", "),
                    placeholders.join(", ")
                );
                let values: Vec<rusqlite::types::Value> =
                    names.iter().map(|n| to_sql(&row[*n])).collect();
                transaction.execute(&sql, rusqlite::params_from_iter(values))?;
            }
        }

        // The export's own version stamp is data; the live one is this build.
        transaction.execute(
            "UPDATE workspace SET schema_version = ?1 WHERE id = 1",
            params![migrations::target_version()],
        )?;

        let broken: i64 =
            transaction.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })?;
        if broken > 0 {
            return Err(Error::InvalidInput(
                "that export refers to rows it does not contain",
            ));
        }

        rebuild_search_index(&transaction)?;
        transaction.commit()?;
        Ok(())
    })();
    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    outcome?;
    log::info!("workspace replaced from an export");
    counts(conn)
}

/// Rebuild `search_fts` from items, events and their documents.
pub fn rebuild_search_index(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM search_fts", [])?;
    conn.execute(
        "INSERT INTO search_fts (owner_kind, owner_id, title, body)
         SELECT 'item', id, title, '' FROM item WHERE archived_at IS NULL",
        [],
    )?;
    conn.execute(
        "INSERT INTO search_fts (owner_kind, owner_id, title, body)
         SELECT 'event', id, title, '' FROM event",
        [],
    )?;
    let mut statement = conn.prepare(
        "SELECT owner_kind, owner_id, group_concat(content_json, char(10))
         FROM (SELECT owner_kind, owner_id, content_json FROM block ORDER BY position)
         GROUP BY owner_kind, owner_id",
    )?;
    let documents = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (kind, id, joined) in documents {
        let text = joined
            .lines()
            .map(block_text)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        conn.execute(
            "UPDATE search_fts SET body = ?3 WHERE owner_kind = ?1 AND owner_id = ?2",
            params![kind, id, text],
        )?;
    }
    Ok(())
}

/// The plain text of one block's content document.
///
/// A ProseMirror node is `{ type, text?, content?: [node] }`; the text is the
/// leaves, in order. Nothing else — marks, attributes, node types — carries
/// words a person would search for or read in an export.
pub fn block_text(content_json: &str) -> String {
    fn walk(node: &Value, out: &mut Vec<String>) {
        if let Some(text) = node.get("text").and_then(Value::as_str) {
            out.push(text.to_string());
        }
        if let Some(children) = node.get("content").and_then(Value::as_array) {
            for child in children {
                walk(child, out);
            }
        }
    }
    let Ok(node) = serde_json::from_str::<Value>(content_json) else {
        return String::new();
    };
    let mut out = Vec::new();
    walk(&node, &mut out);
    out.join("").trim().to_string()
}

// ── Markdown ───────────────────────────────────────────────────────────────

/// The workspace as one Markdown document: a section per collection, a task
/// per line with its dates and values, its document indented beneath.
pub fn markdown(conn: &Connection) -> Result<String> {
    let mut out = String::new();
    out.push_str(&format!("# Tessera export — {}\n", now()));

    let mut collections = conn.prepare("SELECT id, name FROM collection ORDER BY position")?;
    let collections = collections
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    for (collection_id, name) in collections {
        out.push_str(&format!("\n## {name}\n\n"));
        let mut items = conn.prepare(
            "SELECT id, title, due_at, completed_at, recurrence_rrule
             FROM item WHERE collection_id = ?1 AND archived_at IS NULL
             ORDER BY position",
        )?;
        let rows = items
            .query_map(params![collection_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        for (id, title, due, completed, rule) in rows {
            let mark = if completed.is_some() { "x" } else { " " };
            out.push_str(&format!("- [{mark}] {title}"));
            if let Some(due) = due {
                out.push_str(&format!(" · due {due}"));
            }
            if let Some(rule) = rule {
                out.push_str(&format!(" · repeats {rule}"));
            }
            let mut values = conn.prepare(
                "SELECT p.name, v.value_json FROM item_property_value v
                 JOIN property p ON p.id = v.property_id
                 WHERE v.item_id = ?1 ORDER BY p.position",
            )?;
            for value in values.query_map(params![id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })? {
                let (name, json) = value?;
                let shown = serde_json::from_str::<Value>(&json)
                    .map(|v| match v {
                        Value::String(s) => s,
                        other => other.to_string(),
                    })
                    .unwrap_or(json);
                out.push_str(&format!(" · {name}: {shown}"));
            }
            out.push('\n');

            let mut blocks = conn.prepare(
                "SELECT content_json FROM block
                 WHERE owner_kind = 'item' AND owner_id = ?1 ORDER BY position",
            )?;
            for block in blocks.query_map(params![id], |r| r.get::<_, String>(0))? {
                let text = block_text(&block?);
                if !text.is_empty() {
                    out.push_str(&format!("  {text}\n"));
                }
            }
        }
    }
    Ok(out)
}

// ── ICS ────────────────────────────────────────────────────────────────────

fn ics_instant(iso: &str) -> String {
    DateTime::parse_from_rfc3339(iso)
        .map(|t| t.with_timezone(&Utc).format("%Y%m%dT%H%M%SZ").to_string())
        .unwrap_or_default()
}

fn ics_date(iso: &str) -> String {
    iso.get(..10).unwrap_or("").replace('-', "")
}

fn ics_escape(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
}

/// Fold a content line at 75 octets, as RFC 5545 requires.
fn fold(line: &str) -> String {
    let mut out = String::new();
    let mut width = 0;
    for ch in line.chars() {
        let len = ch.len_utf8();
        if width + len > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(ch);
        width += len;
    }
    out
}

/// Events as VEVENT and dated tasks as VTODO, one calendar.
pub fn ics(conn: &Connection) -> Result<String> {
    let mut lines: Vec<String> = vec![
        "BEGIN:VCALENDAR".into(),
        "VERSION:2.0".into(),
        "PRODID:-//Tessera//Tessera//EN".into(),
        "CALSCALE:GREGORIAN".into(),
    ];
    let stamp = ics_instant(&now());

    let mut events = conn.prepare(
        "SELECT id, title, location, starts_at_utc, ends_at_utc, all_day, rrule FROM event",
    )?;
    let rows = events
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)? != 0,
                r.get::<_, Option<String>>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    for (id, title, location, starts, ends, all_day, rule) in rows {
        lines.push("BEGIN:VEVENT".into());
        lines.push(format!("UID:{id}@tessera"));
        lines.push(format!("DTSTAMP:{stamp}"));
        if all_day {
            lines.push(format!("DTSTART;VALUE=DATE:{}", ics_date(&starts)));
            lines.push(format!("DTEND;VALUE=DATE:{}", ics_date(&ends)));
        } else {
            lines.push(format!("DTSTART:{}", ics_instant(&starts)));
            lines.push(format!("DTEND:{}", ics_instant(&ends)));
        }
        lines.push(format!("SUMMARY:{}", ics_escape(&title)));
        if let Some(location) = location.filter(|l| !l.is_empty()) {
            lines.push(format!("LOCATION:{}", ics_escape(&location)));
        }
        if let Some(rule) = rule {
            lines.push(format!("RRULE:{rule}"));
            let mut exceptions = conn.prepare(
                "SELECT original_start_utc FROM event_exception
                 WHERE event_id = ?1 AND kind = 'cancelled'",
            )?;
            for original in exceptions.query_map(params![id], |r| r.get::<_, String>(0))? {
                lines.push(format!("EXDATE:{}", ics_instant(&original?)));
            }
        }
        lines.push("END:VEVENT".into());
    }

    let mut items = conn.prepare(
        "SELECT id, title, due_at, completed_at, recurrence_rrule FROM item
         WHERE due_at IS NOT NULL AND archived_at IS NULL",
    )?;
    let todos = items
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, title, due, completed, rule) in todos {
        lines.push("BEGIN:VTODO".into());
        lines.push(format!("UID:{id}@tessera"));
        lines.push(format!("DTSTAMP:{stamp}"));
        lines.push(format!("DUE:{}", ics_instant(&due)));
        lines.push(format!("SUMMARY:{}", ics_escape(&title)));
        if let Some(done) = completed {
            lines.push("STATUS:COMPLETED".into());
            lines.push(format!("COMPLETED:{}", ics_instant(&done)));
        } else {
            lines.push("STATUS:NEEDS-ACTION".into());
        }
        if let Some(rule) = rule {
            lines.push(format!("RRULE:{rule}"));
        }
        lines.push("END:VTODO".into());
    }

    lines.push("END:VCALENDAR".into());
    Ok(lines
        .iter()
        .map(|l| fold(l))
        .collect::<Vec<_>>()
        .join("\r\n")
        + "\r\n")
}

pub fn write_text(path: &Path, text: &str) -> Result<()> {
    fs::write(path, text).map_err(|_| Error::InvalidInput("that file could not be written"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::calendar::{self, list_calendars};
    use crate::db::items;
    use crate::db::models::{NewEvent, NewItem};

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

    fn event(conn: &Connection, title: &str, rule: Option<&str>) -> String {
        let calendar = list_calendars(conn).unwrap().remove(0).id;
        calendar::create_event(
            conn,
            NewEvent {
                calendar_id: calendar,
                title: title.into(),
                location: Some("Room 4; north wing".into()),
                starts_at_utc: "2026-09-10T12:00:00.000Z".into(),
                ends_at_utc: "2026-09-10T13:00:00.000Z".into(),
                tz: "America/Sao_Paulo".into(),
                all_day: false,
                rrule: rule.map(str::to_string),
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn every_table_is_exported_with_every_column() {
        let mut conn = workspace();
        item(&mut conn, "Buy milk");
        let document = export(&conn).unwrap();
        assert_eq!(document.format, FORMAT);
        assert_eq!(document.schema_version, migrations::target_version());
        for table in TABLES {
            assert!(document.tables.contains_key(*table), "{table} missing");
        }
        let items = &document.tables["item"];
        assert_eq!(items.len(), 1);
        let columns = columns(&conn, "item").unwrap();
        for column in columns {
            assert!(items[0].contains_key(&column), "item.{column} missing");
        }
        assert_eq!(items[0]["title"], "Buy milk");
    }

    #[test]
    fn an_export_imported_into_an_empty_workspace_is_the_same_workspace() {
        let mut source = workspace();
        let id = item(&mut source, "Buy milk");
        items::set_completed(&source, &id, true).unwrap();
        event(&source, "Dentist", Some("FREQ=WEEKLY"));
        source
            .execute(
                "INSERT INTO block (id, owner_kind, owner_id, type, position, content_json, created_at, updated_at)
                 VALUES ('b1', 'item', ?1, 'paragraph', 'a', '{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"semi-skimmed\"}]}', 'now', 'now')",
                params![id],
            )
            .unwrap();
        let before = export(&source).unwrap();

        let mut target = workspace();
        item(&mut target, "Something to be replaced");
        let counts = import(&mut target, &before).unwrap();
        assert_eq!(
            counts,
            Counts {
                items: 1,
                events: 1,
                blocks: 1
            }
        );

        let after = export(&target).unwrap();
        for table in TABLES {
            assert_eq!(
                before.tables[*table], after.tables[*table],
                "{table} differs"
            );
        }
        // The search index was rebuilt from the imported rows.
        let hits: i64 = target
            .query_row(
                "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'skimmed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
        let fk_on: i64 = target
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk_on, 1);
    }

    #[test]
    fn an_export_with_dangling_references_is_refused_whole() {
        let mut source = workspace();
        item(&mut source, "Keep me");
        let mut document = export(&source).unwrap();
        // A value that points at an item the export does not contain.
        document.tables.get_mut("item_property_value").unwrap().push(
            serde_json::json!({"item_id": "ghost", "property_id": "tasks.priority", "value_json": "\"high\""})
                .as_object()
                .unwrap()
                .clone(),
        );
        let mut target = workspace();
        let existing = item(&mut target, "Still here");
        let error = import(&mut target, &document).unwrap_err();
        assert!(matches!(error, Error::InvalidInput(_)));
        // Nothing changed: the transaction rolled back.
        assert!(items::get_item(&target, &existing).is_ok());
    }

    #[test]
    fn a_column_this_schema_does_not_know_is_refused() {
        let mut source = workspace();
        item(&mut source, "x");
        let mut document = export(&source).unwrap();
        document.tables.get_mut("item").unwrap()[0]
            .insert("from_the_future".into(), Value::from(1));
        let mut target = workspace();
        assert!(matches!(
            import(&mut target, &document).unwrap_err(),
            Error::InvalidInput(_)
        ));
    }

    #[test]
    fn block_text_takes_the_leaves_and_nothing_else() {
        assert_eq!(
            block_text(
                r#"{"type":"paragraph","content":[{"type":"text","text":"Hello, ","marks":[{"type":"bold"}]},{"type":"text","text":"world"}]}"#
            ),
            "Hello, world"
        );
        assert_eq!(block_text("{}"), "");
        assert_eq!(block_text("not json"), "");
    }

    #[test]
    fn markdown_lists_tasks_under_their_collection_with_their_facts() {
        let mut conn = workspace();
        let id = item(&mut conn, "Pay rent");
        items::set_schedule(
            &conn,
            &id,
            crate::db::models::ItemSchedule {
                start_at: None,
                due_at: Some("2026-09-04T12:00:00.000Z".into()),
                remind_at: None,
                recurrence_rrule: Some("FREQ=MONTHLY".into()),
                recurrence_mode: Some("schedule".into()),
            },
        )
        .unwrap();
        crate::db::properties::set_value(&conn, &id, "tasks.priority", &Value::from("high"))
            .unwrap();
        let done = item(&mut conn, "Call the plumber");
        items::set_completed(&conn, &done, true).unwrap();

        let text = markdown(&conn).unwrap();
        assert!(text.contains("## Tasks"));
        assert!(text.contains(
            "- [ ] Pay rent · due 2026-09-04T12:00:00.000Z · repeats FREQ=MONTHLY · Priority: high"
        ));
        assert!(text.contains("- [x] Call the plumber"));
    }

    #[test]
    fn ics_carries_events_with_rules_and_dated_tasks_as_todos() {
        let mut conn = workspace();
        let event_id = event(&conn, "Standup, daily", Some("FREQ=DAILY"));
        calendar::set_exception(
            &conn,
            &event_id,
            "2026-09-11T12:00:00.000Z",
            "cancelled",
            None,
            None,
        )
        .unwrap();
        let id = item(&mut conn, "Pay rent");
        items::set_schedule(
            &conn,
            &id,
            crate::db::models::ItemSchedule {
                start_at: None,
                due_at: Some("2026-09-04T12:00:00.000Z".into()),
                remind_at: None,
                recurrence_rrule: None,
                recurrence_mode: None,
            },
        )
        .unwrap();

        let text = ics(&conn).unwrap();
        assert!(text.starts_with("BEGIN:VCALENDAR\r\n"));
        assert!(text.contains("SUMMARY:Standup\\, daily\r\n"));
        assert!(text.contains("LOCATION:Room 4\\; north wing\r\n"));
        assert!(text.contains("DTSTART:20260910T120000Z\r\n"));
        assert!(text.contains("RRULE:FREQ=DAILY\r\n"));
        assert!(text.contains("EXDATE:20260911T120000Z\r\n"));
        assert!(text.contains("BEGIN:VTODO\r\nUID:"));
        assert!(text.contains("DUE:20260904T120000Z\r\n"));
        assert!(text.contains("STATUS:NEEDS-ACTION\r\n"));
        assert!(text.ends_with("END:VCALENDAR\r\n"));
        // Every line respects the 75-octet fold.
        for line in text.split("\r\n") {
            assert!(line.len() <= 75, "{line}");
        }
    }
}
