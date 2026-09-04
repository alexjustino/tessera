//! Full-text search over everything that has a title: items and events.
//!
//! One index, one box (ADR-008). `search_fts` is a standalone FTS5 table kept
//! in step by every write path that touches a title or a document; this module
//! only reads it. Hits come back with the matched words marked by two control
//! characters, which the interface splits into plain and highlighted runs —
//! text, never markup, so nothing typed into a title can reach the page as
//! structure.
//!
//! The query string arrives already shaped by the domain layer (every token
//! quoted, the last one a prefix). Anything else FTS5 rejects is reported as a
//! sentence rather than as a database error, because the person typed it.

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::{Error, Result};

/// Marks the start of a matched run. `char(1)` in SQL, `` in the interface.
const HIT_OPEN: &str = "char(1)";
/// Marks the end of a matched run.
const HIT_CLOSE: &str = "char(2)";

/// How many tokens of body to show around the first hit.
const SNIPPET_TOKENS: i64 = 12;

/// The most hits one query returns, whatever the caller asks for.
pub const MAX_HITS: i64 = 50;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub owner_kind: String,
    pub owner_id: String,
    pub title: String,
    pub body: String,
    pub completed: bool,
}

/// Run one FTS5 query. Titles weigh ten times what bodies do.
///
/// Rows whose owner is gone or archived are filtered here rather than trusted
/// to be absent: the index is written by hand, and a search that returns a
/// ghost is the way a person would find out it had drifted.
pub fn search(conn: &Connection, query: &str, limit: i64) -> Result<Vec<SearchHit>> {
    let limit = limit.clamp(1, MAX_HITS);

    let sql = format!(
        "SELECT s.owner_kind, s.owner_id,
                highlight(search_fts, 2, {HIT_OPEN}, {HIT_CLOSE}),
                snippet(search_fts, 3, {HIT_OPEN}, {HIT_CLOSE}, '…', {SNIPPET_TOKENS}),
                COALESCE(i.completed_at IS NOT NULL, 0)
         FROM search_fts s
         LEFT JOIN item  i ON s.owner_kind = 'item'  AND i.id = s.owner_id
         LEFT JOIN event e ON s.owner_kind = 'event' AND e.id = s.owner_id
         WHERE search_fts MATCH ?1
           AND ((s.owner_kind = 'item' AND i.id IS NOT NULL AND i.archived_at IS NULL)
             OR (s.owner_kind = 'event' AND e.id IS NOT NULL))
         ORDER BY bm25(search_fts, 0.0, 0.0, 10.0, 1.0)
         LIMIT ?2"
    );

    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![query, limit], |row| {
        Ok(SearchHit {
            owner_kind: row.get(0)?,
            owner_id: row.get(1)?,
            title: row.get(2)?,
            body: row.get(3)?,
            completed: row.get::<_, i64>(4)? != 0,
        })
    });

    // FTS5 reports a malformed query as a SQLite error at query time. The
    // domain layer shapes every query before it gets here, so this is a
    // defence, and it speaks to the person rather than about the database.
    let rows = match rows {
        Ok(rows) => rows,
        Err(rusqlite::Error::SqliteFailure(_, Some(message)))
            if message.contains("fts5") || message.contains("syntax") =>
        {
            return Err(Error::InvalidInput(
                "that is not something the search understands",
            ));
        }
        Err(error) => return Err(error.into()),
    };

    let mut hits = Vec::new();
    for row in rows {
        match row {
            Ok(hit) => hits.push(hit),
            Err(rusqlite::Error::SqliteFailure(_, Some(message)))
                if message.contains("fts5") || message.contains("syntax") =>
            {
                return Err(Error::InvalidInput(
                    "that is not something the search understands",
                ));
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::calendar::{self, list_calendars};
    use crate::db::items;
    use crate::db::migrations;
    use crate::db::models::{NewEvent, NewItem};

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
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
        .expect("create")
        .id
    }

    fn event(conn: &Connection, title: &str) -> String {
        let calendar = list_calendars(conn).expect("calendars").remove(0).id;
        calendar::create_event(
            conn,
            NewEvent {
                calendar_id: calendar,
                title: title.into(),
                location: None,
                starts_at_utc: "2026-09-10T12:00:00.000Z".into(),
                ends_at_utc: "2026-09-10T13:00:00.000Z".into(),
                tz: "America/Sao_Paulo".into(),
                all_day: false,
                rrule: None,
            },
        )
        .expect("create event")
        .id
    }

    const OPEN: char = '\u{1}';
    const CLOSE: char = '\u{2}';

    #[test]
    fn finds_an_item_by_a_word_and_by_a_prefix() {
        let mut conn = workspace();
        let id = item(&mut conn, "Buy milk for the office");
        item(&mut conn, "Call the plumber");

        let hits = search(&conn, "\"milk\"", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].owner_id, id);
        assert_eq!(hits[0].owner_kind, "item");
        assert!(!hits[0].completed);

        let prefix = search(&conn, "\"mil\"*", 10).unwrap();
        assert_eq!(prefix.len(), 1);
    }

    #[test]
    fn marks_the_matched_words_with_control_characters_only() {
        let mut conn = workspace();
        item(&mut conn, "Buy <b>milk</b> today");

        let hits = search(&conn, "\"milk\"", 10).unwrap();
        let title = &hits[0].title;
        assert_eq!(title, &format!("Buy <b>{OPEN}milk{CLOSE}</b> today"));
        // The markup typed into the title is still text, and still there.
        assert!(title.contains("<b>"));
    }

    #[test]
    fn one_box_finds_events_too() {
        let mut conn = workspace();
        let event_id = event(&conn, "Dentist appointment");
        item(&mut conn, "Book the dentist");

        let hits = search(&conn, "\"dentist\"", 10).unwrap();
        let kinds: Vec<&str> = hits.iter().map(|h| h.owner_kind.as_str()).collect();
        assert!(kinds.contains(&"item"));
        assert!(kinds.contains(&"event"));
        let event_hit = hits.iter().find(|h| h.owner_kind == "event").unwrap();
        assert_eq!(event_hit.owner_id, event_id);
        assert!(!event_hit.completed);
    }

    #[test]
    fn renaming_and_deleting_an_event_keeps_the_index_honest() {
        let mut conn = workspace();
        let id = event(&conn, "Standup");
        assert_eq!(search(&conn, "\"standup\"", 10).unwrap().len(), 1);

        calendar::rename_event(&conn, &id, "Retro").unwrap();
        assert_eq!(search(&conn, "\"standup\"", 10).unwrap().len(), 0);
        assert_eq!(search(&conn, "\"retro\"", 10).unwrap().len(), 1);

        calendar::delete_event(&conn, &id).unwrap();
        assert_eq!(search(&conn, "\"retro\"", 10).unwrap().len(), 0);
        let _ = &mut conn;
    }

    #[test]
    fn a_deleted_item_is_not_found_and_a_completed_one_says_so() {
        let mut conn = workspace();
        let gone = item(&mut conn, "Throwaway note");
        let done = item(&mut conn, "Finished note");

        items::delete_item(&mut conn, &gone).unwrap();
        items::set_completed(&conn, &done, true).unwrap();

        let hits = search(&conn, "\"note\"", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].owner_id, done);
        assert!(hits[0].completed);
    }

    #[test]
    fn ignores_accents_the_way_a_person_typing_fast_does() {
        let mut conn = workspace();
        item(&mut conn, "Revisar a cláusula três");
        assert_eq!(search(&conn, "\"clausula\"", 10).unwrap().len(), 1);
        assert_eq!(search(&conn, "\"CLÁUSULA\"", 10).unwrap().len(), 1);
    }

    #[test]
    fn a_title_hit_outranks_a_body_hit() {
        let mut conn = workspace();
        let in_body = item(&mut conn, "Weekly review");
        let in_title = item(&mut conn, "Budget spreadsheet");
        // Give the first item a body that mentions budget; the second has it
        // in the title and should come first.
        conn.execute(
            "UPDATE search_fts SET body = 'check the budget numbers' WHERE owner_id = ?1",
            params![in_body],
        )
        .unwrap();

        let hits = search(&conn, "\"budget\"", 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].owner_id, in_title);
        assert!(hits[1].body.contains(OPEN));
    }

    #[test]
    fn a_malformed_query_is_a_sentence_not_a_crash() {
        let mut conn = workspace();
        item(&mut conn, "anything");
        let error = search(&conn, "milk OR", 10).unwrap_err();
        assert!(matches!(error, Error::InvalidInput(_)));
        let error = search(&conn, "NEAR(", 10).unwrap_err();
        assert!(matches!(error, Error::InvalidInput(_)));
    }

    #[test]
    fn the_limit_is_honoured_and_capped() {
        let mut conn = workspace();
        for n in 0..60 {
            item(&mut conn, &format!("Report {n}"));
        }
        assert_eq!(search(&conn, "\"report\"", 3).unwrap().len(), 3);
        assert_eq!(
            search(&conn, "\"report\"", 500).unwrap().len(),
            MAX_HITS as usize
        );
        assert_eq!(search(&conn, "\"report\"", 0).unwrap().len(), 1);
    }
}
