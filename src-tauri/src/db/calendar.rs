//! The calendar repository: calendars, events, exceptions and time blocks.
//!
//! An event is a unit of time and an item is a unit of work (ADR-008). This
//! module owns the first and bridges to the second.
//!
//! What it does not own is the calendar itself. Expanding a rule, applying an
//! exception, deciding where a box sits on a grid — all of that is pure
//! TypeScript in `src/domain/calendar.ts` and `src/domain/schedule.ts`, where
//! the timezone arithmetic has a daylight-saving test. The host stores instants
//! and hands back windows.

use rusqlite::{params, Connection, OptionalExtension, Row};
use uuid::Uuid;

use super::items::now;
use super::models::{Calendar, CalendarEvent, EventException, NewEvent, WorkHours};
use crate::error::{Error, Result};

const MAX_TITLE: usize = 500;

fn read_calendar(row: &Row<'_>) -> rusqlite::Result<Calendar> {
    Ok(Calendar {
        id: row.get("id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        visible: row.get::<_, i64>("visible")? != 0,
        position: row.get("position")?,
    })
}

fn read_event(row: &Row<'_>) -> rusqlite::Result<CalendarEvent> {
    Ok(CalendarEvent {
        id: row.get("id")?,
        calendar_id: row.get("calendar_id")?,
        title: row.get("title")?,
        location: row.get("location")?,
        starts_at_utc: row.get("starts_at_utc")?,
        ends_at_utc: row.get("ends_at_utc")?,
        tz: row.get("tz")?,
        all_day: row.get::<_, i64>("all_day")? != 0,
        rrule: row.get("rrule")?,
        busy: row.get::<_, i64>("busy")? != 0,
        // Present when this event is time reserved for a task.
        item_id: row.get("item_id")?,
    })
}

pub fn list_calendars(conn: &Connection) -> Result<Vec<Calendar>> {
    let mut statement =
        conn.prepare("SELECT id, name, color, visible, position FROM calendar ORDER BY position")?;
    let rows = statement.query_map([], read_calendar)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn list_work_hours(conn: &Connection) -> Result<Vec<WorkHours>> {
    let mut statement = conn
        .prepare("SELECT weekday, starts_minute, ends_minute FROM work_hours ORDER BY weekday")?;
    let rows = statement.query_map([], |row| {
        Ok(WorkHours {
            weekday: row.get("weekday")?,
            starts_minute: row.get("starts_minute")?,
            ends_minute: row.get("ends_minute")?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Events that could appear in a window.
///
/// "Could", not "do". A recurring event is returned whenever its series might
/// reach the window, because only the domain layer can expand the rule and say
/// for certain — and asking the database to reason about RRULE is how a
/// calendar ends up with two implementations of recurrence that disagree.
pub fn list_events(conn: &Connection, from: &str, to: &str) -> Result<Vec<CalendarEvent>> {
    let mut statement = conn.prepare(
        "SELECT e.id, e.calendar_id, e.title, e.location, e.starts_at_utc, e.ends_at_utc,
                e.tz, e.all_day, e.rrule, e.busy, b.item_id
         FROM event e
         LEFT JOIN time_block b ON b.event_id = e.id
         WHERE (e.rrule IS NOT NULL AND e.starts_at_utc < ?2)
            OR (e.rrule IS NULL AND e.starts_at_utc < ?2 AND e.ends_at_utc > ?1)
         ORDER BY e.starts_at_utc",
    )?;
    let rows = statement.query_map(params![from, to], read_event)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn list_exceptions(conn: &Connection) -> Result<Vec<EventException>> {
    let mut statement = conn.prepare(
        "SELECT event_id, original_start_utc, kind, starts_at_utc, ends_at_utc
         FROM event_exception",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(EventException {
            event_id: row.get("event_id")?,
            original_start_utc: row.get("original_start_utc")?,
            kind: row.get("kind")?,
            starts_at_utc: row.get("starts_at_utc")?,
            ends_at_utc: row.get("ends_at_utc")?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn clean_title(title: &str) -> Result<String> {
    let trimmed = title.trim();
    if trimmed.chars().count() > MAX_TITLE {
        return Err(Error::InvalidInput("that title is too long"));
    }
    Ok(trimmed.to_string())
}

fn check_span(starts: &str, ends: &str) -> Result<()> {
    if ends < starts {
        return Err(Error::InvalidInput("an event cannot end before it starts"));
    }
    Ok(())
}

pub fn get_event(conn: &Connection, id: &str) -> Result<CalendarEvent> {
    conn.query_row(
        "SELECT e.id, e.calendar_id, e.title, e.location, e.starts_at_utc, e.ends_at_utc,
                e.tz, e.all_day, e.rrule, e.busy, b.item_id
         FROM event e
         LEFT JOIN time_block b ON b.event_id = e.id
         WHERE e.id = ?1",
        params![id],
        read_event,
    )
    .optional()?
    .ok_or(Error::NotFound)
}

pub fn create_event(conn: &Connection, new: NewEvent) -> Result<CalendarEvent> {
    let title = clean_title(&new.title)?;
    check_span(&new.starts_at_utc, &new.ends_at_utc)?;

    let id = Uuid::now_v7().to_string();
    let timestamp = now();

    conn.execute(
        "INSERT INTO event (id, calendar_id, title, location, starts_at_utc, ends_at_utc,
                            tz, all_day, rrule, busy, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10)",
        params![
            id,
            new.calendar_id,
            title,
            new.location,
            new.starts_at_utc,
            new.ends_at_utc,
            new.tz,
            new.all_day as i64,
            new.rrule,
            timestamp
        ],
    )?;
    // Events share the search index with items (ADR-008): one search box finds
    // both. `search_fts` is standalone, so the row is written here, by hand.
    conn.execute(
        "INSERT INTO search_fts (owner_kind, owner_id, title, body)
         VALUES ('event', ?1, ?2, '')",
        params![id, title],
    )?;

    get_event(conn, &id)
}

pub fn move_event(conn: &Connection, id: &str, starts: &str, ends: &str) -> Result<CalendarEvent> {
    check_span(starts, ends)?;

    let changed = conn.execute(
        "UPDATE event SET starts_at_utc = ?2, ends_at_utc = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, starts, ends, now()],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    get_event(conn, id)
}

pub fn rename_event(conn: &Connection, id: &str, title: &str) -> Result<CalendarEvent> {
    let title = clean_title(title)?;
    let changed = conn.execute(
        "UPDATE event SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, title, now()],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    conn.execute(
        "UPDATE search_fts SET title = ?2 WHERE owner_kind = 'event' AND owner_id = ?1",
        params![id, title],
    )?;
    get_event(conn, id)
}

pub fn delete_event(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute("DELETE FROM event WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    conn.execute(
        "DELETE FROM search_fts WHERE owner_kind = 'event' AND owner_id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Cancel or move one occurrence of a series, leaving the rest alone.
///
/// Keyed on the original start rather than on the new one, so the exception
/// keeps pointing at the right occurrence however many times the rule is
/// re-expanded — including after the series itself is edited.
pub fn set_exception(
    conn: &Connection,
    event_id: &str,
    original_start: &str,
    kind: &str,
    starts: Option<&str>,
    ends: Option<&str>,
) -> Result<()> {
    if kind != "cancelled" && kind != "moved" {
        return Err(Error::InvalidInput(
            "that is not something to do to an occurrence",
        ));
    }
    if kind == "moved" && (starts.is_none() || ends.is_none()) {
        return Err(Error::InvalidInput("a moved occurrence needs a new time"));
    }
    if let (Some(from), Some(to)) = (starts, ends) {
        check_span(from, to)?;
    }
    get_event(conn, event_id)?;

    conn.execute(
        "INSERT INTO event_exception (event_id, original_start_utc, kind, starts_at_utc, ends_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (event_id, original_start_utc) DO UPDATE
           SET kind = excluded.kind,
               starts_at_utc = excluded.starts_at_utc,
               ends_at_utc = excluded.ends_at_utc",
        params![event_id, original_start, kind, starts, ends],
    )?;
    Ok(())
}

/// Reserve time for a task: an event, and the row that says it is that task.
///
/// One transaction, because a half-written block is an event on somebody's
/// calendar that belongs to nothing and cannot be traced back to the work it
/// was meant to protect.
/// Items that have time reserved for them, whatever the window.
///
/// The side panel calls itself "Not scheduled", and a task with a block next
/// month is scheduled — so the question is asked of the whole table, not of
/// the days on screen.
pub fn time_blocked_item_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT DISTINCT tb.item_id FROM time_block tb JOIN event e ON e.id = tb.event_id",
    )?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

pub fn create_time_block(
    conn: &mut Connection,
    item_id: &str,
    calendar_id: &str,
    starts: &str,
    ends: &str,
    tz: &str,
) -> Result<CalendarEvent> {
    check_span(starts, ends)?;

    let title: String = conn
        .query_row(
            "SELECT title FROM item WHERE id = ?1",
            params![item_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(Error::NotFound)?;

    let event_id = Uuid::now_v7().to_string();
    let timestamp = now();

    let transaction = conn.transaction()?;
    transaction.execute(
        "INSERT INTO event (id, calendar_id, title, starts_at_utc, ends_at_utc, tz,
                            all_day, busy, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, ?7, ?7)",
        params![event_id, calendar_id, title, starts, ends, tz, timestamp],
    )?;
    transaction.execute(
        "INSERT INTO time_block (id, item_id, event_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![Uuid::now_v7().to_string(), item_id, event_id, timestamp],
    )?;
    transaction.commit()?;

    get_event(conn, &event_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items::create_item;
    use crate::db::migrations;
    use crate::db::models::NewItem;

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
                title: "write the report".into(),
                position: "V".into(),
            },
        )
        .expect("create")
        .id
    }

    fn an_event(conn: &Connection, starts: &str, ends: &str) -> CalendarEvent {
        create_event(
            conn,
            NewEvent {
                calendar_id: "personal".into(),
                title: "a meeting".into(),
                location: None,
                starts_at_utc: starts.into(),
                ends_at_utc: ends.into(),
                tz: "America/Sao_Paulo".into(),
                all_day: false,
                rrule: None,
            },
        )
        .expect("create event")
    }

    #[test]
    fn a_new_workspace_has_a_calendar_and_a_working_week() {
        let conn = workspace();
        assert_eq!(list_calendars(&conn).expect("list").len(), 1);
        assert_eq!(list_work_hours(&conn).expect("list").len(), 5);
    }

    #[test]
    fn events_in_a_window_come_back_and_others_do_not() {
        let conn = workspace();
        an_event(
            &conn,
            "2026-09-07T12:00:00.000Z",
            "2026-09-07T13:00:00.000Z",
        );
        an_event(
            &conn,
            "2026-10-07T12:00:00.000Z",
            "2026-10-07T13:00:00.000Z",
        );

        let found = list_events(
            &conn,
            "2026-09-07T00:00:00.000Z",
            "2026-09-08T00:00:00.000Z",
        )
        .expect("list");
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn a_recurring_event_is_returned_even_when_its_first_occurrence_is_long_past() {
        // Only the domain layer can expand a rule. Asking the database to reason
        // about RRULE is how a calendar ends up with two implementations of
        // recurrence that disagree.
        let conn = workspace();
        create_event(
            &conn,
            NewEvent {
                calendar_id: "personal".into(),
                title: "weekly".into(),
                location: None,
                starts_at_utc: "2020-01-06T12:00:00.000Z".into(),
                ends_at_utc: "2020-01-06T13:00:00.000Z".into(),
                tz: "America/Sao_Paulo".into(),
                all_day: false,
                rrule: Some("FREQ=WEEKLY".into()),
            },
        )
        .expect("create");

        let found = list_events(
            &conn,
            "2026-09-07T00:00:00.000Z",
            "2026-09-08T00:00:00.000Z",
        )
        .expect("list");
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn an_exception_is_stored_once_per_occurrence_and_can_be_changed() {
        let conn = workspace();
        let event = an_event(
            &conn,
            "2026-09-07T12:00:00.000Z",
            "2026-09-07T13:00:00.000Z",
        );

        set_exception(
            &conn,
            &event.id,
            "2026-09-07T12:00:00.000Z",
            "cancelled",
            None,
            None,
        )
        .expect("cancel");
        set_exception(
            &conn,
            &event.id,
            "2026-09-07T12:00:00.000Z",
            "moved",
            Some("2026-09-07T18:00:00.000Z"),
            Some("2026-09-07T19:00:00.000Z"),
        )
        .expect("move");

        let exceptions = list_exceptions(&conn).expect("list");
        assert_eq!(exceptions.len(), 1, "the same occurrence got two rows");
        assert_eq!(exceptions[0].kind, "moved");
    }

    #[test]
    fn a_time_block_is_an_event_that_knows_its_task() {
        let mut conn = workspace();
        let item = an_item(&mut conn);

        let event = create_time_block(
            &mut conn,
            &item,
            "personal",
            "2026-09-07T12:00:00.000Z",
            "2026-09-07T13:00:00.000Z",
            "America/Sao_Paulo",
        )
        .expect("block");

        assert_eq!(event.item_id.as_deref(), Some(item.as_str()));
        assert_eq!(event.title, "write the report");
    }

    #[test]
    fn deleting_the_task_takes_its_reserved_time_with_it() {
        // Time reserved for work that no longer exists is an appointment with
        // nothing.
        let mut conn = workspace();
        let item = an_item(&mut conn);
        let event = create_time_block(
            &mut conn,
            &item,
            "personal",
            "2026-09-07T12:00:00.000Z",
            "2026-09-07T13:00:00.000Z",
            "America/Sao_Paulo",
        )
        .expect("block");

        crate::db::items::delete_item(&mut conn, &item).expect("delete");

        let blocks: i64 = conn
            .query_row("SELECT count(*) FROM time_block", [], |row| row.get(0))
            .unwrap_or(-1);
        assert_eq!(blocks, 0, "the block outlived its task");
        // The event itself is left, deliberately: an hour that was actually
        // spent is still a fact about the day, and silently erasing time from
        // somebody's calendar is worse than leaving it.
        assert!(get_event(&conn, &event.id).is_ok());
    }

    #[test]
    fn moving_an_event_keeps_its_identity() {
        let conn = workspace();
        let event = an_event(
            &conn,
            "2026-09-07T12:00:00.000Z",
            "2026-09-07T13:00:00.000Z",
        );

        let moved = move_event(
            &conn,
            &event.id,
            "2026-09-07T15:00:00.000Z",
            "2026-09-07T16:00:00.000Z",
        )
        .expect("move");

        assert_eq!(moved.id, event.id);
        assert_eq!(moved.starts_at_utc, "2026-09-07T15:00:00.000Z");
    }

    // ── Negative cases ──────────────────────────────────────────────────────

    #[test]
    fn refuses_an_event_that_ends_before_it_starts() {
        let conn = workspace();
        let result = create_event(
            &conn,
            NewEvent {
                calendar_id: "personal".into(),
                title: "backwards".into(),
                location: None,
                starts_at_utc: "2026-09-07T13:00:00.000Z".into(),
                ends_at_utc: "2026-09-07T12:00:00.000Z".into(),
                tz: "America/Sao_Paulo".into(),
                all_day: false,
                rrule: None,
            },
        );
        assert!(matches!(result, Err(Error::InvalidInput(_))));
    }

    #[test]
    fn refuses_to_move_an_event_backwards_onto_itself() {
        let conn = workspace();
        let event = an_event(
            &conn,
            "2026-09-07T12:00:00.000Z",
            "2026-09-07T13:00:00.000Z",
        );
        assert!(matches!(
            move_event(
                &conn,
                &event.id,
                "2026-09-07T15:00:00.000Z",
                "2026-09-07T14:00:00.000Z"
            ),
            Err(Error::InvalidInput(_))
        ));
    }

    #[test]
    fn refuses_a_moved_occurrence_with_nowhere_to_move_to() {
        let conn = workspace();
        let event = an_event(
            &conn,
            "2026-09-07T12:00:00.000Z",
            "2026-09-07T13:00:00.000Z",
        );
        assert!(matches!(
            set_exception(
                &conn,
                &event.id,
                "2026-09-07T12:00:00.000Z",
                "moved",
                None,
                None
            ),
            Err(Error::InvalidInput(_))
        ));
    }

    #[test]
    fn refuses_an_exception_on_an_event_that_does_not_exist() {
        let conn = workspace();
        assert!(matches!(
            set_exception(
                &conn,
                "nope",
                "2026-09-07T12:00:00.000Z",
                "cancelled",
                None,
                None
            ),
            Err(Error::NotFound)
        ));
    }

    #[test]
    fn refuses_to_reserve_time_for_a_task_that_does_not_exist() {
        let mut conn = workspace();
        assert!(matches!(
            create_time_block(
                &mut conn,
                "nope",
                "personal",
                "2026-09-07T12:00:00.000Z",
                "2026-09-07T13:00:00.000Z",
                "UTC"
            ),
            Err(Error::NotFound)
        ));
    }

    #[test]
    fn reports_a_missing_event_rather_than_pretending() {
        let conn = workspace();
        assert!(matches!(get_event(&conn, "nope"), Err(Error::NotFound)));
        assert!(matches!(delete_event(&conn, "nope"), Err(Error::NotFound)));
        assert!(matches!(
            rename_event(&conn, "nope", "x"),
            Err(Error::NotFound)
        ));
    }
}
