//! Notes started from a meeting: one page for one occurrence of an event.
//!
//! Pressing Meeting notes on an event opens its page, making it the first time. The
//! page is named for the meeting and its day, and when a page of that name already
//! exists it is the one meant, so it is paired rather than refused. What goes in the
//! page is written by the editor, as for any page; the host only keeps the pair.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use super::pages::{self, title_key, Page};
use crate::error::{Error, Result};

/// A page paired with an occurrence, with what the page needs to say about it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct EventPage {
    pub event_id: String,
    pub original_start: String,
    pub page_id: String,
    pub event_title: String,
}

/// Every pair, with the meeting's name.
pub fn list(conn: &Connection) -> Result<Vec<EventPage>> {
    let mut statement = conn.prepare(
        "SELECT ep.event_id, ep.original_start, ep.page_id, e.title
         FROM event_page ep JOIN event e ON e.id = ep.event_id
         ORDER BY ep.original_start",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(EventPage {
            event_id: row.get(0)?,
            original_start: row.get(1)?,
            page_id: row.get(2)?,
            event_title: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// The page of this occurrence, made and paired the first time. True when it is new.
pub fn open(
    conn: &mut Connection,
    event_id: &str,
    original_start: &str,
    title: &str,
    position: &str,
) -> Result<(Page, bool)> {
    let paired: Option<String> = conn
        .query_row(
            "SELECT page_id FROM event_page WHERE event_id = ?1 AND original_start = ?2",
            params![event_id, original_start],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(page_id) = paired {
        return Ok((pages::get(conn, &page_id)?, false));
    }

    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM event WHERE id = ?1",
            params![event_id],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if !exists {
        return Err(Error::NotFound);
    }

    // A page of that name is the one meant: pair it rather than refuse the press.
    let named: Option<String> = conn
        .query_row(
            "SELECT id FROM page WHERE title_key = ?1",
            params![title_key(title)],
            |row| row.get(0),
        )
        .optional()?;
    let (page, created) = match named {
        Some(id) => (pages::get(conn, &id)?, false),
        None => (pages::create(conn, title, position)?, true),
    };

    conn.execute(
        "INSERT INTO event_page (event_id, original_start, page_id) VALUES (?1, ?2, ?3)",
        params![event_id, original_start, page.id],
    )?;
    Ok((page, created))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::calendar::{create_event, delete_event};
    use crate::db::migrations;
    use crate::db::models::NewEvent;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    fn meeting(conn: &Connection) -> String {
        create_event(
            conn,
            NewEvent {
                calendar_id: "personal".into(),
                title: "Weekly sync".into(),
                location: None,
                starts_at_utc: "2026-11-09T13:00:00Z".into(),
                ends_at_utc: "2026-11-09T14:00:00Z".into(),
                tz: "America/Sao_Paulo".into(),
                all_day: false,
                rrule: Some("FREQ=WEEKLY".into()),
            },
        )
        .unwrap()
        .id
    }

    const WEEK_ONE: &str = "2026-11-09T13:00:00Z";
    const WEEK_TWO: &str = "2026-11-16T13:00:00Z";

    #[test]
    fn the_first_press_makes_and_pairs_the_page_and_the_next_finds_it() {
        let mut conn = workspace();
        let event = meeting(&conn);

        let (made, created) =
            open(&mut conn, &event, WEEK_ONE, "Weekly sync — Mon, Nov 9", "V").unwrap();
        let (found, again) =
            open(&mut conn, &event, WEEK_ONE, "Weekly sync — Mon, Nov 9", "V").unwrap();

        assert!(created);
        assert!(!again);
        assert_eq!(made.id, found.id);
        let pairs = list(&conn).unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].event_title, "Weekly sync");
    }

    #[test]
    fn each_week_of_a_series_has_a_page_of_its_own() {
        let mut conn = workspace();
        let event = meeting(&conn);
        let (one, _) = open(&mut conn, &event, WEEK_ONE, "Weekly sync — Mon, Nov 9", "V").unwrap();
        let (two, _) = open(
            &mut conn,
            &event,
            WEEK_TWO,
            "Weekly sync — Mon, Nov 16",
            "W",
        )
        .unwrap();
        assert_ne!(one.id, two.id);
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn a_page_already_of_that_name_is_paired_not_refused() {
        let mut conn = workspace();
        let event = meeting(&conn);
        let existing = pages::create(&mut conn, "Weekly sync — Mon, Nov 9", "V").unwrap();

        let (page, created) =
            open(&mut conn, &event, WEEK_ONE, "weekly sync — mon, nov 9", "W").unwrap();

        assert!(!created);
        assert_eq!(page.id, existing.id);
    }

    #[test]
    fn deleting_the_meeting_leaves_the_page_and_drops_the_pair() {
        let mut conn = workspace();
        let event = meeting(&conn);
        let (page, _) = open(&mut conn, &event, WEEK_ONE, "Weekly sync — Mon, Nov 9", "V").unwrap();

        delete_event(&conn, &event).unwrap();

        assert!(list(&conn).unwrap().is_empty());
        assert!(pages::get(&conn, &page.id).is_ok());
    }

    // ── Negative cases ─────────────────────────────────────────────────────
    #[test]
    fn refuses_a_meeting_that_does_not_exist_and_makes_no_page() {
        let mut conn = workspace();
        assert!(matches!(
            open(&mut conn, "gone", WEEK_ONE, "Nothing", "V"),
            Err(Error::NotFound)
        ));
        assert!(pages::list(&conn).unwrap().is_empty());
    }

    #[test]
    fn refuses_an_empty_name_and_pairs_nothing() {
        let mut conn = workspace();
        let event = meeting(&conn);
        assert!(open(&mut conn, &event, WEEK_ONE, "   ", "V").is_err());
        assert!(list(&conn).unwrap().is_empty());
    }
}
