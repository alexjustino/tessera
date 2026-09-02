//! The claim the first vertical slice actually makes: what you wrote is still
//! there after the process is gone.
//!
//! Every other repository test runs against an in-memory database, which is
//! fast and proves the logic — and proves nothing at all about durability. A
//! transaction that was never really committed, a journal mode that loses the
//! last write, a schema created on a connection rather than in the file: none of
//! those show up in memory. They show up when a person closes the application
//! and opens it again, which is the worst possible moment to find out.
//!
//! So this test uses a real file, drops the connection, and opens it again.

use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use tessera_lib::db::items::{self};
use tessera_lib::db::migrations;
use tessera_lib::db::models::NewItem;

/// A scratch database that removes itself, whatever the test does.
struct Scratch {
    path: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tessera-test-{name}-{}.sqlite3",
            uuid::Uuid::now_v7()
        ));
        Self { path }
    }

    /// Open the workspace the way the application does.
    fn open(&self) -> Connection {
        let conn = Connection::open(&self.path).expect("open the workspace");
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "synchronous", "NORMAL").unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).expect("migrate");
        conn
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        let _ = fs::remove_file(self.path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(self.path.with_extension("sqlite3-shm"));
    }
}

#[test]
fn what_you_wrote_is_still_there_after_a_restart() {
    let scratch = Scratch::new("restart");

    // ── First run ───────────────────────────────────────────────────────────
    let (kept_id, completed_id) = {
        let mut conn = scratch.open();

        let kept = items::create_item(
            &mut conn,
            NewItem {
                collection_id: "tasks".into(),
                title: "still here tomorrow".into(),
                position: "V".into(),
            },
        )
        .expect("create");

        let completed = items::create_item(
            &mut conn,
            NewItem {
                collection_id: "tasks".into(),
                title: "done before closing".into(),
                position: "a".into(),
            },
        )
        .expect("create");

        items::set_completed(&conn, &completed.id, true).expect("complete");

        (kept.id, completed.id)
        // The connection is dropped here. This is the restart.
    };

    // ── Second run ──────────────────────────────────────────────────────────
    let conn = scratch.open();

    let kept = items::get_item(&conn, &kept_id).expect("the open item survived");
    assert_eq!(kept.title, "still here tomorrow");
    assert!(!kept.is_completed());

    let completed = items::get_item(&conn, &completed_id).expect("the completed item survived");
    assert!(
        completed.is_completed(),
        "completion did not survive the restart"
    );
    assert!(
        completed.completed_at.is_some(),
        "the completion time was lost"
    );

    // The default list still shows one and hides the other, as it did before.
    let open_items = items::list_items(&conn, Some("tasks"), false).expect("list");
    assert_eq!(open_items.len(), 1);
    assert_eq!(open_items[0].id, kept_id);

    let all_items = items::list_items(&conn, Some("tasks"), true).expect("list");
    assert_eq!(all_items.len(), 2);
}

#[test]
fn the_schema_is_migrated_once_and_not_again_on_the_next_run() {
    let scratch = Scratch::new("migrate-once");

    let first = {
        let conn = scratch.open();
        migrations::current_version(&conn)
    };
    let second = {
        let conn = scratch.open();
        migrations::current_version(&conn)
    };

    assert_eq!(first, migrations::target_version());
    assert_eq!(second, migrations::target_version());

    // And the seeded collection was not duplicated by the second run.
    let conn = scratch.open();
    assert_eq!(items::list_collections(&conn).expect("list").len(), 1);
}

#[test]
fn a_deleted_item_stays_deleted() {
    let scratch = Scratch::new("delete");

    let id = {
        let mut conn = scratch.open();
        let item = items::create_item(
            &mut conn,
            NewItem {
                collection_id: "tasks".into(),
                title: "temporary".into(),
                position: "V".into(),
            },
        )
        .expect("create");
        items::delete_item(&mut conn, &item.id).expect("delete");
        item.id
    };

    let conn = scratch.open();
    assert!(items::get_item(&conn, &id).is_err());
    assert!(items::list_items(&conn, None, true)
        .expect("list")
        .is_empty());
}
