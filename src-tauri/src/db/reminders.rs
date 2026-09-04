//! The reminder repository: what is due to fire, and what already did.
//!
//! One table serves items and events alike, which is what lets the scheduler
//! be a single loop rather than one per kind. A row is pending until it has
//! either fired or been dismissed; snoozing clears the firing so the same row
//! comes round again, rather than minting a second reminder for the same thing.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use uuid::Uuid;

use super::items::now;
use crate::error::{Error, Result};

/// A reminder the scheduler still owes somebody.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PendingReminder {
    pub id: String,
    pub owner_kind: String,
    pub owner_id: String,
    /// When it should fire — the snooze, if there is one, otherwise the original.
    pub fire_at: String,
    /// What the toast says. Read at fire time, so a renamed task fires under
    /// its new name.
    pub title: String,
}

/// Everything not yet fired and not dismissed, soonest first.
pub fn pending(conn: &Connection) -> Result<Vec<PendingReminder>> {
    let mut statement = conn.prepare(
        "SELECT r.id, r.owner_kind, r.owner_id,
                COALESCE(r.snoozed_until, r.fire_at) AS fire_at,
                COALESCE(i.title, e.title, '') AS title
         FROM reminder r
         LEFT JOIN item  i ON r.owner_kind = 'item'  AND i.id = r.owner_id
         LEFT JOIN event e ON r.owner_kind = 'event' AND e.id = r.owner_id
         WHERE r.fired_at IS NULL AND r.dismissed_at IS NULL
           -- A reminder whose owner is gone, or whose task is already done, is
           -- owed to nobody.
           AND (r.owner_kind <> 'item' OR (i.id IS NOT NULL AND i.completed_at IS NULL))
           AND (r.owner_kind <> 'event' OR e.id IS NOT NULL)
         ORDER BY fire_at",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(PendingReminder {
            id: row.get("id")?,
            owner_kind: row.get("owner_kind")?,
            owner_id: row.get("owner_id")?,
            fire_at: row.get("fire_at")?,
            title: row.get("title")?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn mark_fired(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute(
        "UPDATE reminder SET fired_at = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

/// Come back later. Clears the firing so the same row fires again at `until`.
pub fn snooze(conn: &Connection, id: &str, until: &str) -> Result<()> {
    let changed = conn.execute(
        "UPDATE reminder SET snoozed_until = ?2, fired_at = NULL WHERE id = ?1",
        params![id, until],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

pub fn dismiss(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute(
        "UPDATE reminder SET dismissed_at = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    Ok(())
}

/// The reminder that belongs to an item, if any, keyed by the item.
pub fn for_item(conn: &Connection, item_id: &str) -> Result<Option<PendingReminder>> {
    Ok(pending(conn)?.into_iter().find(|r| r.owner_id == item_id))
}

/// Make the reminder table agree with an item's `remind_at`.
///
/// An item owns at most one live reminder. Setting a new time replaces the old
/// row rather than adding beside it — two toasts for one task is the kind of
/// bug that gets a product uninstalled — and clearing the time removes it.
pub fn sync_for_item(conn: &Connection, item_id: &str, remind_at: Option<&str>) -> Result<()> {
    conn.execute(
        "DELETE FROM reminder
         WHERE owner_kind = 'item' AND owner_id = ?1 AND fired_at IS NULL",
        params![item_id],
    )?;

    if let Some(fire_at) = remind_at {
        conn.execute(
            "INSERT INTO reminder (id, owner_kind, owner_id, fire_at, kind)
             VALUES (?1, 'item', ?2, ?3, 'absolute')",
            params![Uuid::now_v7().to_string(), item_id, fire_at],
        )?;
    }
    Ok(())
}

/// How many open items are due before an instant. What the tray shows.
pub fn count_open_due_before(conn: &Connection, before: &str) -> Result<i64> {
    let count: i64 = conn.query_row(
        "SELECT count(*) FROM item
         WHERE completed_at IS NULL AND archived_at IS NULL
           AND due_at IS NOT NULL AND due_at < ?1",
        params![before],
        |row| row.get(0),
    )?;
    Ok(count)
}

/// The item behind a reminder, so a toast action can act on it.
pub fn owner_item(conn: &Connection, reminder_id: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT owner_id FROM reminder WHERE id = ?1 AND owner_kind = 'item'",
            params![reminder_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items::{create_item, set_completed};
    use crate::db::migrations;
    use crate::db::models::NewItem;

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    fn an_item(conn: &mut Connection, title: &str) -> String {
        create_item(
            conn,
            NewItem {
                collection_id: "tasks".into(),
                title: title.into(),
                position: "V".into(),
            },
        )
        .expect("create")
        .id
    }

    #[test]
    fn syncing_creates_one_reminder_and_replaces_it_rather_than_adding() {
        // Two toasts for one task is the kind of bug that gets a product
        // uninstalled.
        let mut conn = workspace();
        let item = an_item(&mut conn, "call the plumber");

        sync_for_item(&conn, &item, Some("2026-09-10T12:00:00.000Z")).expect("first");
        sync_for_item(&conn, &item, Some("2026-09-11T12:00:00.000Z")).expect("second");

        let live = pending(&conn).expect("pending");
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].fire_at, "2026-09-11T12:00:00.000Z");
        assert_eq!(live[0].title, "call the plumber");
    }

    #[test]
    fn clearing_the_time_removes_the_reminder() {
        let mut conn = workspace();
        let item = an_item(&mut conn, "x");
        sync_for_item(&conn, &item, Some("2026-09-10T12:00:00.000Z")).expect("set");

        sync_for_item(&conn, &item, None).expect("clear");

        assert!(pending(&conn).expect("pending").is_empty());
    }

    #[test]
    fn pending_comes_soonest_first_and_honours_a_snooze() {
        let mut conn = workspace();
        let late = an_item(&mut conn, "late");
        let soon = an_item(&mut conn, "soon");
        sync_for_item(&conn, &late, Some("2026-09-12T12:00:00.000Z")).unwrap();
        sync_for_item(&conn, &soon, Some("2026-09-10T12:00:00.000Z")).unwrap();

        let before = pending(&conn).unwrap();
        assert_eq!(before[0].title, "soon");

        // Snoozing "soon" past "late" reorders them: the effective time is what
        // the scheduler sleeps until.
        snooze(&conn, &before[0].id, "2026-09-13T12:00:00.000Z").unwrap();
        let after = pending(&conn).unwrap();
        assert_eq!(after[0].title, "late");
        assert_eq!(after[1].fire_at, "2026-09-13T12:00:00.000Z");
    }

    #[test]
    fn a_fired_reminder_is_no_longer_pending_until_snoozed() {
        let mut conn = workspace();
        let item = an_item(&mut conn, "x");
        sync_for_item(&conn, &item, Some("2026-09-10T12:00:00.000Z")).unwrap();
        let id = pending(&conn).unwrap()[0].id.clone();

        mark_fired(&conn, &id).unwrap();
        assert!(pending(&conn).unwrap().is_empty());

        // Snooze brings the same row back, rather than minting a second one.
        snooze(&conn, &id, "2026-09-10T12:10:00.000Z").unwrap();
        let again = pending(&conn).unwrap();
        assert_eq!(again.len(), 1);
        assert_eq!(again[0].id, id);
    }

    #[test]
    fn a_completed_task_owes_nobody_a_reminder() {
        // The classic annoyance: being nagged about something already done.
        let mut conn = workspace();
        let item = an_item(&mut conn, "done");
        sync_for_item(&conn, &item, Some("2026-09-10T12:00:00.000Z")).unwrap();

        set_completed(&conn, &item, true).unwrap();

        assert!(pending(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_deleted_task_takes_its_reminder_out_of_the_queue() {
        let mut conn = workspace();
        let item = an_item(&mut conn, "gone");
        sync_for_item(&conn, &item, Some("2026-09-10T12:00:00.000Z")).unwrap();

        crate::db::items::delete_item(&mut conn, &item).unwrap();

        assert!(pending(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_dismissed_reminder_stays_dismissed() {
        let mut conn = workspace();
        let item = an_item(&mut conn, "x");
        sync_for_item(&conn, &item, Some("2026-09-10T12:00:00.000Z")).unwrap();
        let id = pending(&conn).unwrap()[0].id.clone();

        dismiss(&conn, &id).unwrap();
        assert!(pending(&conn).unwrap().is_empty());
    }

    #[test]
    fn counts_what_is_due_before_an_instant_and_still_open() {
        let mut conn = workspace();
        for (title, due) in [
            ("late", "2026-09-01T12:00:00.000Z"),
            ("today", "2026-09-05T20:00:00.000Z"),
            ("later", "2026-09-20T12:00:00.000Z"),
        ] {
            let id = an_item(&mut conn, title);
            conn.execute(
                "UPDATE item SET due_at = ?2 WHERE id = ?1",
                params![id, due],
            )
            .unwrap();
        }
        let undated = an_item(&mut conn, "undated");
        let _ = undated;

        assert_eq!(
            count_open_due_before(&conn, "2026-09-06T03:00:00.000Z").unwrap(),
            2
        );
    }

    #[test]
    fn reports_a_missing_reminder_rather_than_pretending() {
        let conn = workspace();
        assert!(matches!(mark_fired(&conn, "nope"), Err(Error::NotFound)));
        assert!(matches!(
            snooze(&conn, "nope", "2026-09-10T12:00:00.000Z"),
            Err(Error::NotFound)
        ));
        assert!(matches!(dismiss(&conn, "nope"), Err(Error::NotFound)));
        assert_eq!(owner_item(&conn, "nope").unwrap(), None);
    }
}
