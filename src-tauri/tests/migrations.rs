//! The promise `VERSIONING.md` makes about every release: a database written by
//! the previous version opens in this one, migrated, without loss.
//!
//! Migrations are forward-only and numbered, so the interesting case is not
//! "does an empty database migrate" — the unit tests cover that — but "does a
//! database that somebody has been *using* migrate". So this walks the versions
//! one at a time, writing rows at each step with only the columns that existed
//! then, and checks at the end that everything written along the way is still
//! there and that the schema is at head.
//!
//! It runs against a file, not memory: a migration that only works on a fresh
//! connection is a migration that has never met a real workspace.

use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use tessera_lib::db::migrations;

struct Scratch {
    path: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tessera-migrations-{name}-{}.sqlite3",
            uuid::Uuid::now_v7()
        ));
        Self { path }
    }

    fn open(&self) -> Connection {
        let conn = Connection::open(&self.path).expect("open");
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
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

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap_or(-1)
}

/// Apply migrations one at a time, up to and including `version`.
///
/// The runner applies everything pending in one call, so stepping means calling
/// it repeatedly against a database whose version is raised by hand — which is
/// exactly what a person's workspace looks like partway through the product's
/// history.
fn migrate_to(conn: &Connection, version: i64) {
    // `apply` is all-or-nothing to head, so a stepwise walk runs each
    // migration's SQL directly and stamps the version, mirroring what the
    // runner would have done at that point in history.
    let sources = migrations::sources();
    for (index, (name, sql)) in sources.iter().enumerate() {
        let this = index as i64 + 1;
        if this > version || this <= migrations::current_version(conn) {
            continue;
        }
        conn.execute_batch(&format!(
            "BEGIN; {sql} UPDATE workspace SET schema_version = {this} WHERE id = 1; COMMIT;"
        ))
        .unwrap_or_else(|error| panic!("migration {name} failed: {error}"));
    }
}

#[test]
fn a_workspace_written_at_every_version_survives_the_walk_to_head() {
    let scratch = Scratch::new("walk");
    let conn = scratch.open();
    let head = migrations::target_version();
    assert!(head >= 7, "this test knows the shape of the first seven");

    // ── v1: the core tables ────────────────────────────────────────────────
    migrate_to(&conn, 1);
    assert_eq!(migrations::current_version(&conn), 1);
    conn.execute(
        "INSERT INTO collection (id, name, icon, color, position, created_at, updated_at)
         VALUES ('v1', 'From version one', NULL, NULL, 'a', '2026-01-01T00:00:00.000Z',
                 '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO item (id, collection_id, title, position, created_at, updated_at)
         VALUES ('item-v1', 'v1', 'Written at version one', 'a', '2026-01-01T00:00:00.000Z',
                 '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO search_fts (owner_kind, owner_id, title, body)
         VALUES ('item', 'item-v1', 'Written at version one', '')",
        [],
    )
    .unwrap();

    // ── v2: the seeded collection ──────────────────────────────────────────
    migrate_to(&conn, 2);
    assert_eq!(
        count(&conn, "SELECT count(*) FROM collection WHERE id = 'tasks'"),
        1
    );
    conn.execute(
        "INSERT INTO item (id, collection_id, title, position, created_at, updated_at)
         VALUES ('item-v2', 'tasks', 'Written at version two', 'b', '2026-01-02T00:00:00.000Z',
                 '2026-01-02T00:00:00.000Z')",
        [],
    )
    .unwrap();

    // ── v3: properties, with values on the rows written before them ────────
    migrate_to(&conn, 3);
    assert_eq!(
        count(
            &conn,
            "SELECT count(*) FROM property WHERE id = 'tasks.priority'"
        ),
        1
    );
    conn.execute(
        "INSERT INTO item_property_value (item_id, property_id, value_json)
         VALUES ('item-v2', 'tasks.priority', '\"high\"')",
        [],
    )
    .unwrap();

    // ── v4 and v5: the seeded views ────────────────────────────────────────
    migrate_to(&conn, 5);
    assert!(count(&conn, "SELECT count(*) FROM view") >= 3);

    // ── v6: the cross-collection date views ────────────────────────────────
    migrate_to(&conn, 6);
    assert_eq!(
        count(&conn, "SELECT count(*) FROM view WHERE id = 'view.today'"),
        1
    );

    // ── v7: the calendar, and an event on it ───────────────────────────────
    migrate_to(&conn, 7);
    conn.execute(
        "INSERT INTO event (id, calendar_id, title, starts_at_utc, ends_at_utc, tz, all_day,
                            busy, created_at, updated_at)
         VALUES ('event-v7', 'personal', 'Written at version seven',
                 '2026-02-01T12:00:00.000Z', '2026-02-01T13:00:00.000Z', 'America/Sao_Paulo',
                 0, 1, '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    // A view of a person's own, written before the rebuild that migration 010
    // performs on this table. SQLite cannot widen a CHECK in place, so 010
    // copies every row into a new table — and a copy is exactly the kind of
    // migration that loses things quietly.
    conn.execute(
        "INSERT INTO view (id, collection_id, name, kind, config_json, position)
         VALUES ('mine', 'tasks', 'My own view', 'board', '{\"mine\":true}', 'zz')",
        [],
    )
    .unwrap();

    // ── Everything after v7, in one go, the way a real upgrade arrives ─────
    migrations::apply(&conn).expect("migrate to head");
    assert_eq!(migrations::current_version(&conn), head);

    // ── Nothing written along the way was lost ─────────────────────────────
    for (id, title) in [
        ("item-v1", "Written at version one"),
        ("item-v2", "Written at version two"),
    ] {
        let found: String = conn
            .query_row("SELECT title FROM item WHERE id = ?1", [id], |r| r.get(0))
            .unwrap_or_else(|_| panic!("{id} was lost"));
        assert_eq!(found, title);
    }
    let priority: String = conn
        .query_row(
            "SELECT value_json FROM item_property_value
             WHERE item_id = 'item-v2' AND property_id = 'tasks.priority'",
            [],
            |r| r.get(0),
        )
        .expect("the property value was lost");
    assert_eq!(priority, "\"high\"");
    assert_eq!(
        count(&conn, "SELECT count(*) FROM event WHERE id = 'event-v7'"),
        1,
        "the event was lost"
    );
    assert_eq!(
        count(
            &conn,
            "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'version'"
        ),
        1,
        "the index row written at version one was lost"
    );

    // The rebuilt `view` table kept every row, its configuration and its order.
    let (name, kind, config, position): (String, String, String, String) = conn
        .query_row(
            "SELECT name, kind, config_json, position FROM view WHERE id = 'mine'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .expect("the view written before the rebuild was lost");
    assert_eq!(name, "My own view");
    assert_eq!(kind, "board");
    assert_eq!(config, "{\"mine\":true}");
    assert_eq!(position, "zz");
    assert_eq!(
        count(&conn, "SELECT count(*) FROM view WHERE id = 'view.today'"),
        1,
        "a seeded view was lost in the rebuild"
    );

    // The one-running-timer index arrives with migration 011 on an upgraded
    // database, not only on a fresh one — the unit tests only ever see fresh.
    conn.execute(
        "INSERT INTO time_entry (id, item_id, started_at, ended_at, created_at)
         VALUES ('timer', 'item-v1', '2026-03-01T09:00:00.000Z', NULL,
                 '2026-03-01T09:00:00.000Z')",
        [],
    )
    .unwrap();
    assert!(
        conn.execute(
            "INSERT INTO time_entry (id, item_id, started_at, ended_at, created_at)
             VALUES ('second', 'item-v2', '2026-03-01T09:05:00.000Z', NULL,
                     '2026-03-01T09:05:00.000Z')",
            [],
        )
        .is_err(),
        "the upgraded database accepted a second running timer"
    );

    // The foreign keys the walk relied on still hold.
    assert_eq!(
        count(&conn, "SELECT count(*) FROM pragma_foreign_key_check"),
        0
    );
}

#[test]
fn a_database_at_the_previous_version_migrates_to_this_one() {
    let scratch = Scratch::new("n-minus-one");
    let conn = scratch.open();
    let head = migrations::target_version();

    migrate_to(&conn, head - 1);
    assert_eq!(migrations::current_version(&conn), head - 1);

    // A workspace in use at N-1: the seeded collection has always existed by
    // then, so a row can be written the way the product writes one.
    conn.execute(
        "INSERT INTO item (id, collection_id, title, position, created_at, updated_at)
         VALUES ('before', 'tasks', 'Written before the upgrade', 'a',
                 '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();

    migrations::apply(&conn).expect("migrate the last step");

    assert_eq!(migrations::current_version(&conn), head);
    let title: String = conn
        .query_row("SELECT title FROM item WHERE id = 'before'", [], |r| {
            r.get(0)
        })
        .expect("the row from N-1 was lost");
    assert_eq!(title, "Written before the upgrade");
}

#[test]
fn reopening_a_migrated_file_applies_nothing_and_loses_nothing() {
    let scratch = Scratch::new("reopen");
    let head = migrations::target_version();

    {
        let conn = scratch.open();
        migrations::apply(&conn).expect("migrate");
        conn.execute(
            "INSERT INTO item (id, collection_id, title, position, created_at, updated_at)
             VALUES ('kept', 'tasks', 'Still here', 'a', '2026-01-01T00:00:00.000Z',
                     '2026-01-01T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }

    let conn = scratch.open();
    assert_eq!(migrations::current_version(&conn), head);
    migrations::apply(&conn).expect("second open");
    assert_eq!(migrations::current_version(&conn), head);
    assert_eq!(
        count(&conn, "SELECT count(*) FROM item WHERE id = 'kept'"),
        1
    );
}

#[test]
fn every_migration_is_numbered_in_order_and_never_reordered() {
    let sources = migrations::sources();
    assert_eq!(sources.len() as i64, migrations::target_version());
    for (index, (name, sql)) in sources.iter().enumerate() {
        let expected = format!("{:03}_", index + 1);
        assert!(
            name.starts_with(&expected),
            "migration {index} is named `{name}`, expected it to start with `{expected}`"
        );
        assert!(!sql.trim().is_empty(), "migration `{name}` is empty");
    }
}
