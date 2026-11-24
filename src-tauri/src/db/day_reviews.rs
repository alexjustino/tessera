//! The daily ritual's record (migration 023): a day planned in the morning and closed
//! at night, and what it came to.
//!
//! The score is worked out by the interface, live, from the day's tasks and clock
//! (ADR-045). Kept here once the day is closed, it becomes a history the live score
//! cannot give: yesterday's tasks have moved on, and their figures with them.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::items::now;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DayReview {
    pub day: String,
    pub planned_at: Option<String>,
    pub closed_at: Option<String>,
    pub score: Option<i64>,
    pub done: i64,
    pub carried: i64,
    pub tracked_minutes: i64,
    pub note: Option<String>,
}

/// What closing a day records.
#[derive(Debug, Clone, Deserialize)]
pub struct DayClose {
    pub score: Option<i64>,
    pub done: i64,
    pub carried: i64,
    pub tracked_minutes: i64,
    pub note: Option<String>,
}

const LONGEST_NOTE: usize = 2_000;

fn check_day(day: &str) -> Result<()> {
    let bytes = day.as_bytes();
    let shaped = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit());
    if !shaped {
        return Err(Error::InvalidInput("that is not a day"));
    }
    Ok(())
}

fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<DayReview> {
    Ok(DayReview {
        day: row.get(0)?,
        planned_at: row.get(1)?,
        closed_at: row.get(2)?,
        score: row.get(3)?,
        done: row.get(4)?,
        carried: row.get(5)?,
        tracked_minutes: row.get(6)?,
        note: row.get(7)?,
    })
}

const COLUMNS: &str = "day, planned_at, closed_at, score, done, carried, tracked_minutes, note";

/// The days from `from` on, oldest first.
pub fn list(conn: &Connection, from: &str) -> Result<Vec<DayReview>> {
    check_day(from)?;
    let mut statement = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM day_review WHERE day >= ?1 ORDER BY day"
    ))?;
    let rows = statement.query_map(params![from], read)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get(conn: &Connection, day: &str) -> Result<Option<DayReview>> {
    check_day(day)?;
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM day_review WHERE day = ?1"),
            params![day],
            read,
        )
        .optional()?)
}

/// The day was planned. Planning it again keeps the first time.
pub fn mark_planned(conn: &Connection, day: &str) -> Result<DayReview> {
    check_day(day)?;
    conn.execute(
        "INSERT INTO day_review (day, planned_at) VALUES (?1, ?2)
         ON CONFLICT (day) DO UPDATE SET planned_at = COALESCE(planned_at, excluded.planned_at)",
        params![day, now()],
    )?;
    get(conn, day)?.ok_or(Error::NotFound)
}

/// Close a day with what it came to. Closing it again replaces the figures: the
/// last close is the one that knew the most.
pub fn close(conn: &Connection, day: &str, close: &DayClose) -> Result<DayReview> {
    check_day(day)?;
    if let Some(score) = close.score {
        if !(0..=100).contains(&score) {
            return Err(Error::InvalidInput("a score is out of 100"));
        }
    }
    if close.done < 0 || close.carried < 0 || close.tracked_minutes < 0 {
        return Err(Error::InvalidInput("a count cannot be negative"));
    }
    let note = close
        .note
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty());
    if note.is_some_and(|text| text.chars().count() > LONGEST_NOTE) {
        return Err(Error::InvalidInput(
            "that is too long for a line about the day",
        ));
    }
    conn.execute(
        "INSERT INTO day_review (day, closed_at, score, done, carried, tracked_minutes, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (day) DO UPDATE SET
             closed_at = excluded.closed_at, score = excluded.score, done = excluded.done,
             carried = excluded.carried, tracked_minutes = excluded.tracked_minutes,
             note = excluded.note",
        params![
            day,
            now(),
            close.score,
            close.done,
            close.carried,
            close.tracked_minutes,
            note
        ],
    )?;
    get(conn, day)?.ok_or(Error::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    fn closing(score: Option<i64>) -> DayClose {
        DayClose {
            score,
            done: 4,
            carried: 2,
            tracked_minutes: 190,
            note: Some("  Shipped the report. ".into()),
        }
    }

    #[test]
    fn a_day_is_planned_then_closed_in_one_row() {
        let conn = workspace();
        let planned = mark_planned(&conn, "2026-11-07").unwrap();
        assert!(planned.planned_at.is_some());
        assert!(planned.closed_at.is_none());

        let closed = close(&conn, "2026-11-07", &closing(Some(72))).unwrap();

        assert_eq!(closed.planned_at, planned.planned_at);
        assert!(closed.closed_at.is_some());
        assert_eq!(closed.score, Some(72));
        assert_eq!(closed.note.as_deref(), Some("Shipped the report."));
        assert_eq!(list(&conn, "2026-11-01").unwrap().len(), 1);
    }

    #[test]
    fn planning_again_keeps_the_first_time() {
        let conn = workspace();
        let first = mark_planned(&conn, "2026-11-07").unwrap();
        let again = mark_planned(&conn, "2026-11-07").unwrap();
        assert_eq!(first.planned_at, again.planned_at);
    }

    #[test]
    fn closing_again_replaces_the_figures() {
        let conn = workspace();
        close(&conn, "2026-11-07", &closing(Some(40))).unwrap();
        let again = close(&conn, "2026-11-07", &closing(Some(65))).unwrap();
        assert_eq!(again.score, Some(65));
    }

    #[test]
    fn lists_the_days_in_order_from_a_day() {
        let conn = workspace();
        for day in ["2026-11-07", "2026-11-05", "2026-10-30"] {
            close(&conn, day, &closing(None)).unwrap();
        }
        let days: Vec<_> = list(&conn, "2026-11-01")
            .unwrap()
            .into_iter()
            .map(|review| review.day)
            .collect();
        assert_eq!(days, vec!["2026-11-05", "2026-11-07"]);
    }

    #[test]
    fn a_blank_line_is_no_note() {
        let conn = workspace();
        let mut blank = closing(None);
        blank.note = Some("   ".into());
        assert_eq!(close(&conn, "2026-11-07", &blank).unwrap().note, None);
    }

    // ── Negative cases ─────────────────────────────────────────────────────
    #[test]
    fn refuses_what_is_not_a_day() {
        let conn = workspace();
        assert!(matches!(
            mark_planned(&conn, "tomorrow"),
            Err(Error::InvalidInput(_))
        ));
        assert!(matches!(
            mark_planned(&conn, "2026-1-7"),
            Err(Error::InvalidInput(_))
        ));
        assert!(list(&conn, "2026-11-01").unwrap().is_empty());
    }

    #[test]
    fn refuses_a_score_out_of_100_or_a_negative_count() {
        let conn = workspace();
        assert!(close(&conn, "2026-11-07", &closing(Some(101))).is_err());
        let mut negative = closing(None);
        negative.done = -1;
        assert!(close(&conn, "2026-11-07", &negative).is_err());
        assert!(get(&conn, "2026-11-07").unwrap().is_none());
    }

    #[test]
    fn refuses_a_note_too_long() {
        let conn = workspace();
        let mut long = closing(None);
        long.note = Some("x".repeat(2_001));
        assert!(close(&conn, "2026-11-07", &long).is_err());
    }
}
