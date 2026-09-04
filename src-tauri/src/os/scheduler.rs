//! The reminder scheduler: one loop that sleeps until the next thing is due.
//!
//! # Shape
//!
//! A single task that reads the soonest pending reminder, sleeps until it, fires
//! the toast, records the firing, and goes round again. It does not poll every
//! second — but it does cap every sleep at a minute, and that cap is the whole
//! story of surviving a laptop lid.
//!
//! When Windows suspends, a `sleep_until` set for 09:00 does not wake at 09:00;
//! it wakes when the machine does, and the timer may then report that no time
//! has passed at all. Capping the sleep means the loop re-reads the clock at
//! least once a minute whatever happened to it in between, so a reminder that
//! came due while the lid was shut fires within a minute of the lid opening
//! rather than never.
//!
//! # Waking early
//!
//! Setting a reminder for two minutes from now must not wait behind a sleep
//! aimed at tomorrow. So every write that touches a reminder nudges the loop,
//! and the loop re-plans.
//!
//! # Catch-up
//!
//! Reminders that came due while the application was closed are owed, not
//! forgotten. On the first pass they fire — but grouped into one toast when
//! there are several, because forty toasts at once is not a reminder, it is a
//! punishment.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use tauri::{AppHandle, Manager};
use tokio::sync::Notify;

use crate::db::reminders::{self, PendingReminder};
use crate::db::Db;
use crate::os::notify;

/// The longest the loop will sleep without re-reading the clock.
pub const MAX_SLEEP: Duration = Duration::from_secs(60);

/// Reminders older than this at startup are fired as a group, not one by one.
const CATCH_UP_GROUP_AFTER: usize = 3;

/// A handle to the running loop.
#[derive(Clone)]
pub struct Scheduler {
    wake: Arc<Notify>,
    paused_until: Arc<Mutex<Option<DateTime<Utc>>>>,
}

impl Scheduler {
    /// Ask the loop to re-plan now. Cheap, idempotent, safe from any thread.
    pub fn nudge(&self) {
        self.wake.notify_one();
    }

    /// Hold every toast until `until`. Reminders keep accumulating and fire when
    /// the pause lifts, grouped if there are many.
    pub fn pause_until(&self, until: DateTime<Utc>) {
        *self.paused_until.lock().expect("pause lock") = Some(until);
        self.nudge();
    }

    pub fn resume(&self) {
        *self.paused_until.lock().expect("pause lock") = None;
        self.nudge();
    }

    pub fn paused_until(&self) -> Option<DateTime<Utc>> {
        *self.paused_until.lock().expect("pause lock")
    }
}

/// How long to sleep before the next look at the queue.
///
/// Pure, so the cap and the "already due" case can be tested without a clock.
pub fn next_sleep(now: DateTime<Utc>, next_fire: Option<DateTime<Utc>>) -> Duration {
    match next_fire {
        None => MAX_SLEEP,
        Some(at) if at <= now => Duration::ZERO,
        Some(at) => {
            let until = (at - now).to_std().unwrap_or(Duration::ZERO);
            until.min(MAX_SLEEP)
        }
    }
}

/// Which of the pending reminders are due now.
pub fn due(pending: &[PendingReminder], now: DateTime<Utc>) -> Vec<&PendingReminder> {
    pending
        .iter()
        .filter(|r| parse(&r.fire_at).is_some_and(|at| at <= now))
        .collect()
}

fn parse(instant: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(instant)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Start the loop. Returns the handle the rest of the application uses.
pub fn start(app: AppHandle) -> Scheduler {
    let scheduler = Scheduler {
        wake: Arc::new(Notify::new()),
        paused_until: Arc::new(Mutex::new(None)),
    };

    let handle = scheduler.clone();
    tauri::async_runtime::spawn(async move {
        let mut first_pass = true;
        loop {
            let now = Utc::now();

            // Paused: sleep until the pause lifts, or until nudged.
            if let Some(until) = handle.paused_until() {
                if until > now {
                    let wait = (until - now)
                        .to_std()
                        .unwrap_or(Duration::ZERO)
                        .min(MAX_SLEEP);
                    tokio::select! {
                        _ = tokio::time::sleep(wait) => {}
                        _ = handle.wake.notified() => {}
                    }
                    continue;
                }
                handle.resume();
            }

            let pending = {
                let db = app.state::<Db>();
                let conn = db.0.lock().expect("the database lock was poisoned");
                reminders::pending(&conn).unwrap_or_default()
            };

            let ready: Vec<PendingReminder> = due(&pending, now).into_iter().cloned().collect();

            if !ready.is_empty() {
                fire(&app, &ready, first_pass);
            }
            first_pass = false;

            let next_fire = pending
                .iter()
                .filter(|r| !ready.iter().any(|f| f.id == r.id))
                .filter_map(|r| parse(&r.fire_at))
                .min();

            let wait = next_sleep(Utc::now(), next_fire);
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = handle.wake.notified() => {}
            }
        }
    });

    scheduler
}

/// Raise the toasts, then record that they fired.
///
/// Recorded *after* showing rather than before: if the toast fails, the
/// reminder stays owed and comes round on the next pass, which is the right
/// failure mode for something a person asked to be told about.
fn fire(app: &AppHandle, ready: &[PendingReminder], catching_up: bool) {
    let grouped = catching_up && ready.len() >= CATCH_UP_GROUP_AFTER;

    if grouped {
        let body = format!(
            "{} things came due while Tessera was closed. Open Today to see them.",
            ready.len()
        );
        let outcome = notify::send("Tessera", &body, &[], open_window(app.clone()));
        log::info!(
            "catch-up toast for {} reminders: delivered={}",
            ready.len(),
            outcome.delivered
        );
        if outcome.delivered {
            record_fired(app, ready);
        }
        return;
    }

    for reminder in ready {
        let title = if reminder.title.is_empty() {
            "Reminder".to_string()
        } else {
            reminder.title.clone()
        };
        let outcome = notify::send(
            &title,
            "This is due now.",
            &notify::reminder_actions(),
            on_action(app.clone(), reminder.id.clone()),
        );
        log::info!(
            "reminder {} fired: delivered={} own_identity={}",
            reminder.id,
            outcome.delivered,
            outcome.own_identity
        );
        if outcome.delivered {
            record_fired(app, std::slice::from_ref(reminder));
        }
    }
}

fn record_fired(app: &AppHandle, fired: &[PendingReminder]) {
    let db = app.state::<Db>();
    let conn = db.0.lock().expect("the database lock was poisoned");
    for reminder in fired {
        if let Err(error) = reminders::mark_fired(&conn, &reminder.id) {
            log::error!(
                "could not record that reminder {} fired: {error:?}",
                reminder.id
            );
        }
    }
}

/// What the toast's buttons do. The argument is the one `reminder_actions`
/// attached to the button; anything unrecognised falls back to opening.
fn on_action(app: AppHandle, reminder_id: String) -> impl Fn(String) + Send + 'static {
    move |argument| {
        let outcome: Result<(), String> = (|| {
            let db = app.state::<Db>();
            let mut conn = db.0.lock().expect("the database lock was poisoned");

            if argument.starts_with("action=complete") {
                if let Some(item) =
                    reminders::owner_item(&conn, &reminder_id).map_err(|e| format!("{e:?}"))?
                {
                    crate::db::items::set_completed(&conn, &item, true)
                        .map_err(|e| format!("{e:?}"))?;
                }
                reminders::dismiss(&conn, &reminder_id).map_err(|e| format!("{e:?}"))?;
                return Ok(());
            }

            if argument.starts_with("action=snooze") {
                let minutes: i64 = argument
                    .split('&')
                    .find_map(|part| part.strip_prefix("minutes="))
                    .and_then(|m| m.parse().ok())
                    .unwrap_or(10);
                let until = (Utc::now() + chrono::Duration::minutes(minutes)).to_rfc3339();
                reminders::snooze(&conn, &reminder_id, &until).map_err(|e| format!("{e:?}"))?;
                drop(conn);
                if let Some(scheduler) = app.try_state::<Scheduler>() {
                    scheduler.nudge();
                }
                return Ok(());
            }

            // "Open", or anything we do not recognise: bring the window up.
            let _ = &mut conn;
            Ok(())
        })();

        if let Err(error) = outcome {
            log::error!("toast action {argument:?} failed: {error}");
        }
        if !argument.starts_with("action=snooze") {
            show_window(&app);
        }
    }
}

fn open_window(app: AppHandle) -> impl Fn(String) + Send + 'static {
    move |_| show_window(&app)
}

pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(hour: u32, minute: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 5, hour, minute, 0).unwrap()
    }

    fn reminder(id: &str, fire_at: &str) -> PendingReminder {
        PendingReminder {
            id: id.into(),
            owner_kind: "item".into(),
            owner_id: id.into(),
            fire_at: fire_at.into(),
            title: id.into(),
        }
    }

    #[test]
    fn sleeps_until_the_next_reminder_when_it_is_soon() {
        assert_eq!(
            next_sleep(at(9, 0), Some(at(9, 0) + chrono::Duration::seconds(20))),
            Duration::from_secs(20)
        );
    }

    #[test]
    fn never_sleeps_longer_than_the_cap() {
        // The cap is what survives a closed laptop lid: the loop re-reads the
        // clock at least once a minute whatever happened to it in between.
        assert_eq!(next_sleep(at(9, 0), Some(at(17, 0))), MAX_SLEEP);
        assert_eq!(next_sleep(at(9, 0), None), MAX_SLEEP);
    }

    #[test]
    fn does_not_sleep_at_all_when_something_is_already_due() {
        assert_eq!(next_sleep(at(9, 5), Some(at(9, 0))), Duration::ZERO);
        assert_eq!(next_sleep(at(9, 0), Some(at(9, 0))), Duration::ZERO);
    }

    #[test]
    fn picks_out_what_is_due_and_leaves_the_rest() {
        let pending = vec![
            reminder("past", "2026-09-05T08:00:00+00:00"),
            reminder("now", "2026-09-05T09:00:00+00:00"),
            reminder("later", "2026-09-05T09:00:01+00:00"),
        ];
        let ids: Vec<_> = due(&pending, at(9, 0))
            .into_iter()
            .map(|r| r.id.as_str())
            .collect();
        assert_eq!(ids, ["past", "now"]);
    }

    #[test]
    fn a_reminder_with_an_unreadable_time_is_never_due() {
        // Firing on garbage would be worse than skipping it; skipping it is
        // visible in the queue, firing it is a mystery toast.
        let pending = vec![reminder("bad", "not a time")];
        assert!(due(&pending, at(9, 0)).is_empty());
    }
}
