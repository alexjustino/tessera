//! Days off — a working weekday that has no working hours this time (M3).
//!
//! The host stores the day and what the person called it. It decides nothing
//! about capacity: the domain reads the list and gives those days zero hours
//! wherever capacity is counted, so the year, the receipt and the mosaic can
//! never disagree about whether Christmas is a working day.
//!
//! The day is checked here as well as in the schema: the schema can say the
//! shape (`YYYY-MM-DD`), only a calendar can say that 30 February is not a day.

use rusqlite::{params, Connection};
use serde::Serialize;

use super::items::now;
use crate::error::{Error, Result};

/// The longest a label may be.
const MAX_LABEL: usize = 120;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DayOff {
    pub day: String,
    pub label: String,
    pub created_at: String,
}

fn check_day(day: &str) -> Result<()> {
    if day.len() != 10 || chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").is_err() {
        return Err(Error::InvalidInput(
            "a day off must be a real date, written YYYY-MM-DD",
        ));
    }
    Ok(())
}

/// Every day off, earliest first.
pub fn list(conn: &Connection) -> Result<Vec<DayOff>> {
    let mut statement = conn.prepare("SELECT day, label, created_at FROM day_off ORDER BY day")?;
    let rows = statement.query_map([], |row| {
        Ok(DayOff {
            day: row.get(0)?,
            label: row.get(1)?,
            created_at: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Make `day` a day off, or rename it if it already is one.
pub fn set(conn: &Connection, day: &str, label: &str) -> Result<DayOff> {
    check_day(day)?;
    let label = label.trim();
    if label.chars().count() > MAX_LABEL {
        return Err(Error::InvalidInput(
            "a day off's name can be at most 120 characters",
        ));
    }
    let created_at = now();
    conn.execute(
        "INSERT INTO day_off (day, label, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (day) DO UPDATE SET label = excluded.label",
        params![day, label, created_at],
    )?;
    let row = conn.query_row(
        "SELECT day, label, created_at FROM day_off WHERE day = ?1",
        params![day],
        |row| {
            Ok(DayOff {
                day: row.get(0)?,
                label: row.get(1)?,
                created_at: row.get(2)?,
            })
        },
    )?;
    Ok(row)
}

/// Make `day` a working day again. Removing a day that is not off is refused,
/// so a caller holding a stale list hears about it rather than succeeding at
/// nothing.
pub fn remove(conn: &Connection, day: &str) -> Result<()> {
    check_day(day)?;
    let removed = conn.execute("DELETE FROM day_off WHERE day = ?1", params![day])?;
    if removed == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
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

    #[test]
    fn days_off_are_listed_earliest_first() {
        let conn = workspace();
        set(&conn, "2026-12-25", "Christmas").unwrap();
        set(&conn, "2026-11-20", "Consciência Negra").unwrap();
        let days: Vec<String> = list(&conn).unwrap().into_iter().map(|d| d.day).collect();
        assert_eq!(days, vec!["2026-11-20", "2026-12-25"]);
    }

    #[test]
    fn setting_a_day_twice_renames_it_rather_than_duplicating_it() {
        let conn = workspace();
        let first = set(&conn, "2026-12-25", "Xmas").unwrap();
        let second = set(&conn, "2026-12-25", "  Christmas  ").unwrap();
        assert_eq!(second.label, "Christmas");
        assert_eq!(second.created_at, first.created_at);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn a_label_may_be_empty() {
        let conn = workspace();
        assert_eq!(set(&conn, "2026-12-24", "").unwrap().label, "");
    }

    #[test]
    fn a_day_that_is_not_a_day_is_refused_in_words() {
        let conn = workspace();
        for bad in [
            "2026-02-30",
            "2026-13-01",
            "26-12-25",
            "2026-12-25T00:00",
            "",
            "Christmas",
        ] {
            let error = set(&conn, bad, "x").unwrap_err();
            assert!(
                matches!(error, Error::InvalidInput(_)),
                "{bad} was accepted"
            );
        }
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_label_too_long_is_refused() {
        let conn = workspace();
        let long = "x".repeat(MAX_LABEL + 1);
        assert!(matches!(
            set(&conn, "2026-12-25", &long).unwrap_err(),
            Error::InvalidInput(_)
        ));
    }

    #[test]
    fn removing_a_day_makes_it_a_working_day_again() {
        let conn = workspace();
        set(&conn, "2026-12-25", "Christmas").unwrap();
        remove(&conn, "2026-12-25").unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn removing_a_day_that_is_not_off_is_refused() {
        let conn = workspace();
        assert!(matches!(
            remove(&conn, "2026-12-25").unwrap_err(),
            Error::NotFound
        ));
    }

    #[test]
    fn the_schema_refuses_a_malformed_day_even_past_this_module() {
        let conn = workspace();
        let result = conn.execute(
            "INSERT INTO day_off (day, label, created_at) VALUES ('Christmas', '', 'now')",
            [],
        );
        assert!(result.is_err());
    }
}
