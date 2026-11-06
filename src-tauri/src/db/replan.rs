//! Replan in one press (ADR-052): new dates and new blocks for late tasks, all or
//! nothing, and the exact way back.
//!
//! Where each task goes is worked out in TypeScript (`src/domain/replan.ts`), as the
//! plan is (ADR-046). The host's part is the one a domain function cannot do: write
//! every date and every block in one transaction, so a failure halfway leaves the week
//! as it was, and hand back what was there before, so one press undoes it.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::calendar::{delete_event, insert_time_block};
use super::items::{get_item, set_schedule};
use super::models::ItemSchedule;
use crate::error::{Error, Result};

/// A block to reserve for a task.
#[derive(Debug, Clone, Deserialize)]
pub struct ReplanBlock {
    pub starts_at: String,
    pub ends_at: String,
}

/// One late task's new date, reminder and blocks.
#[derive(Debug, Clone, Deserialize)]
pub struct ReplanChange {
    pub item_id: String,
    pub due_at: String,
    pub remind_at: Option<String>,
    pub blocks: Vec<ReplanBlock>,
}

/// A task's dates as they were before the press.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PreviousSchedule {
    pub item_id: String,
    pub start_at: Option<String>,
    pub due_at: Option<String>,
    pub remind_at: Option<String>,
    pub recurrence_rrule: Option<String>,
    pub recurrence_mode: Option<String>,
}

/// Everything needed to put a replan back: the dates before, and the blocks it made.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReplanUndo {
    pub schedules: Vec<PreviousSchedule>,
    pub event_ids: Vec<String>,
}

/// Write every change, or none of them.
pub fn replan(
    conn: &mut Connection,
    calendar_id: &str,
    tz: &str,
    changes: &[ReplanChange],
) -> Result<ReplanUndo> {
    if changes.is_empty() {
        return Err(Error::InvalidInput("there is nothing late to replan"));
    }

    let transaction = conn.transaction()?;
    let mut undo = ReplanUndo {
        schedules: Vec::new(),
        event_ids: Vec::new(),
    };

    for change in changes {
        let item = get_item(&transaction, &change.item_id)?;
        // What was worked out may be stale by the time it is pressed.
        if item.completed_at.is_some() {
            return Err(Error::InvalidInput(
                "a task was finished meanwhile; look at the plan again",
            ));
        }
        if item.recurrence_rrule.is_some() {
            return Err(Error::InvalidInput(
                "a repeating task is not replanned: its date moves the series",
            ));
        }

        undo.schedules.push(PreviousSchedule {
            item_id: item.id.clone(),
            start_at: item.start_at.clone(),
            due_at: item.due_at.clone(),
            remind_at: item.remind_at.clone(),
            recurrence_rrule: item.recurrence_rrule.clone(),
            recurrence_mode: item.recurrence_mode.clone(),
        });

        set_schedule(
            &transaction,
            &item.id,
            ItemSchedule {
                start_at: item.start_at,
                due_at: Some(change.due_at.clone()),
                remind_at: change.remind_at.clone(),
                recurrence_rrule: None,
                recurrence_mode: item.recurrence_mode,
            },
        )?;

        for block in &change.blocks {
            undo.event_ids.push(insert_time_block(
                &transaction,
                &item.id,
                calendar_id,
                &block.starts_at,
                &block.ends_at,
                tz,
            )?);
        }
    }

    transaction.commit()?;
    Ok(undo)
}

/// Put a replan back: its blocks gone, every date as it was.
///
/// A block the person has deleted since, or a task deleted since, is already where
/// undoing would put it, and is passed over.
pub fn undo_replan(conn: &mut Connection, undo: &ReplanUndo) -> Result<()> {
    let transaction = conn.transaction()?;
    for event_id in &undo.event_ids {
        match delete_event(&transaction, event_id) {
            Ok(()) | Err(Error::NotFound) => {}
            Err(error) => return Err(error),
        }
    }
    for previous in &undo.schedules {
        match get_item(&transaction, &previous.item_id) {
            Ok(_) => {}
            Err(Error::NotFound) => continue,
            Err(error) => return Err(error),
        }
        set_schedule(
            &transaction,
            &previous.item_id,
            ItemSchedule {
                start_at: previous.start_at.clone(),
                due_at: previous.due_at.clone(),
                remind_at: previous.remind_at.clone(),
                recurrence_rrule: previous.recurrence_rrule.clone(),
                recurrence_mode: previous.recurrence_mode.clone(),
            },
        )?;
    }
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::calendar::list_events;
    use crate::db::items::{create_item, set_completed};
    use crate::db::migrations;
    use crate::db::models::NewItem;
    use rusqlite::params;

    const TZ: &str = "America/Sao_Paulo";
    const DUE: &str = "2026-11-02T20:00:00.000Z";
    const REMIND: &str = "2026-11-02T19:00:00.000Z";

    fn workspace() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }

    /// A late task, with a reminder.
    fn late(conn: &mut Connection, title: &str) -> String {
        let id = create_item(
            conn,
            NewItem {
                collection_id: "tasks".into(),
                title: title.into(),
                position: "V".into(),
            },
        )
        .expect("create")
        .id;
        set_schedule(
            conn,
            &id,
            ItemSchedule {
                start_at: None,
                due_at: Some(DUE.into()),
                remind_at: Some(REMIND.into()),
                recurrence_rrule: None,
                recurrence_mode: None,
            },
        )
        .expect("schedule");
        id
    }

    fn change(id: &str, day: u32) -> ReplanChange {
        ReplanChange {
            item_id: id.into(),
            due_at: format!("2026-11-{day:02}T20:00:00.000Z"),
            remind_at: Some(format!("2026-11-{day:02}T19:00:00.000Z")),
            blocks: vec![ReplanBlock {
                starts_at: format!("2026-11-{day:02}T13:00:00.000Z"),
                ends_at: format!("2026-11-{day:02}T14:00:00.000Z"),
            }],
        }
    }

    fn blocks(conn: &Connection) -> usize {
        conn.query_row("SELECT count(*) FROM time_block", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap() as usize
    }

    fn pending_reminders(conn: &Connection, id: &str) -> Vec<String> {
        let mut statement = conn
            .prepare(
                "SELECT fire_at FROM reminder
                 WHERE owner_kind = 'item' AND owner_id = ?1 AND fired_at IS NULL
                   AND kind = 'absolute'",
            )
            .unwrap();
        statement
            .query_map(params![id], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<String>>>()
            .unwrap()
    }

    #[test]
    fn moves_every_date_and_reserves_every_block() {
        let mut conn = workspace();
        let a = late(&mut conn, "a");
        let b = late(&mut conn, "b");

        let undo = replan(&mut conn, "personal", TZ, &[change(&a, 4), change(&b, 5)]).unwrap();

        assert_eq!(
            get_item(&conn, &a).unwrap().due_at.as_deref(),
            Some("2026-11-04T20:00:00.000Z")
        );
        assert_eq!(
            get_item(&conn, &b).unwrap().due_at.as_deref(),
            Some("2026-11-05T20:00:00.000Z")
        );
        assert_eq!(blocks(&conn), 2);
        assert_eq!(undo.event_ids.len(), 2);
        assert_eq!(undo.schedules[0].due_at.as_deref(), Some(DUE));
        let events = list_events(&conn, "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z").unwrap();
        assert!(events.iter().all(|event| event.item_id.is_some()));
    }

    #[test]
    fn the_reminder_that_fires_follows_the_new_one() {
        let mut conn = workspace();
        let a = late(&mut conn, "a");
        replan(&mut conn, "personal", TZ, &[change(&a, 4)]).unwrap();
        assert_eq!(
            pending_reminders(&conn, &a),
            vec!["2026-11-04T19:00:00.000Z"]
        );
    }

    #[test]
    fn undo_puts_back_every_date_and_takes_away_every_block() {
        let mut conn = workspace();
        let a = late(&mut conn, "a");
        let b = late(&mut conn, "b");
        let undo = replan(&mut conn, "personal", TZ, &[change(&a, 4), change(&b, 5)]).unwrap();

        undo_replan(&mut conn, &undo).unwrap();

        for id in [&a, &b] {
            let item = get_item(&conn, id).unwrap();
            assert_eq!(item.due_at.as_deref(), Some(DUE));
            assert_eq!(item.remind_at.as_deref(), Some(REMIND));
            assert_eq!(pending_reminders(&conn, id), vec![REMIND]);
        }
        assert_eq!(blocks(&conn), 0);
    }

    #[test]
    fn undo_passes_over_a_block_or_a_task_deleted_since() {
        let mut conn = workspace();
        let a = late(&mut conn, "a");
        let b = late(&mut conn, "b");
        let undo = replan(&mut conn, "personal", TZ, &[change(&a, 4), change(&b, 5)]).unwrap();
        delete_event(&conn, &undo.event_ids[0]).unwrap();
        crate::db::items::delete_item(&mut conn, &b).unwrap();

        undo_replan(&mut conn, &undo).unwrap();

        assert_eq!(get_item(&conn, &a).unwrap().due_at.as_deref(), Some(DUE));
        assert_eq!(blocks(&conn), 0);
    }

    // ── Negative cases ─────────────────────────────────────────────────────
    #[test]
    fn one_bad_change_writes_nothing_at_all() {
        let mut conn = workspace();
        let a = late(&mut conn, "a");

        let result = replan(
            &mut conn,
            "personal",
            TZ,
            &[change(&a, 4), change("gone", 5)],
        );

        assert!(matches!(result, Err(Error::NotFound)));
        let item = get_item(&conn, &a).unwrap();
        assert_eq!(item.due_at.as_deref(), Some(DUE));
        assert_eq!(pending_reminders(&conn, &a), vec![REMIND]);
        assert_eq!(blocks(&conn), 0);
    }

    #[test]
    fn a_block_that_ends_before_it_starts_writes_nothing() {
        let mut conn = workspace();
        let a = late(&mut conn, "a");
        let mut bad = change(&a, 4);
        bad.blocks[0].ends_at = "2026-11-04T12:00:00.000Z".into();

        assert!(replan(&mut conn, "personal", TZ, &[bad]).is_err());
        assert_eq!(get_item(&conn, &a).unwrap().due_at.as_deref(), Some(DUE));
        assert_eq!(blocks(&conn), 0);
    }

    #[test]
    fn refuses_a_task_finished_meanwhile() {
        let mut conn = workspace();
        let a = late(&mut conn, "a");
        set_completed(&conn, &a, true).unwrap();
        assert!(matches!(
            replan(&mut conn, "personal", TZ, &[change(&a, 4)]),
            Err(Error::InvalidInput(_))
        ));
        assert_eq!(blocks(&conn), 0);
    }

    #[test]
    fn refuses_a_repeating_task() {
        let mut conn = workspace();
        let a = late(&mut conn, "a");
        set_schedule(
            &conn,
            &a,
            ItemSchedule {
                start_at: None,
                due_at: Some(DUE.into()),
                remind_at: None,
                recurrence_rrule: Some("FREQ=WEEKLY".into()),
                recurrence_mode: None,
            },
        )
        .unwrap();
        assert!(matches!(
            replan(&mut conn, "personal", TZ, &[change(&a, 4)]),
            Err(Error::InvalidInput(_))
        ));
        assert_eq!(get_item(&conn, &a).unwrap().due_at.as_deref(), Some(DUE));
    }

    #[test]
    fn refuses_an_empty_press() {
        let mut conn = workspace();
        assert!(matches!(
            replan(&mut conn, "personal", TZ, &[]),
            Err(Error::InvalidInput(_))
        ));
    }

    #[test]
    fn refuses_a_calendar_that_does_not_exist_and_writes_nothing() {
        let mut conn = workspace();
        let a = late(&mut conn, "a");
        assert!(replan(&mut conn, "nowhere", TZ, &[change(&a, 4)]).is_err());
        assert_eq!(get_item(&conn, &a).unwrap().due_at.as_deref(), Some(DUE));
    }
}
