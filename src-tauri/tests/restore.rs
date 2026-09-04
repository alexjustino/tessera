//! The claim the data slice makes: a restored backup restores everything.
//!
//! Against a real file, like `persistence.rs`, because that is where backup and
//! restore live. A workspace is written, backed up, changed, and put back; what
//! comes back must be exactly what was backed up — rows, values, index — and
//! the change must be gone. Then the same through an export file, and the
//! rotation that keeps the folder from growing without bound.

use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use tessera_lib::db::backup;
use tessera_lib::db::export;
use tessera_lib::db::items;
use tessera_lib::db::migrations;
use tessera_lib::db::models::NewItem;
use tessera_lib::db::settings;

struct Scratch {
    dir: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("tessera-restore-{name}-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&dir).unwrap();
        Self { dir }
    }

    fn open(&self) -> Connection {
        let conn = Connection::open(self.dir.join("tessera.sqlite3")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).unwrap();
        conn
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn add(conn: &mut Connection, title: &str) -> String {
    items::create_item(
        conn,
        NewItem {
            collection_id: "tasks".into(),
            title: title.into(),
            position: "a".into(),
        },
    )
    .unwrap()
    .id
}

fn titles(conn: &Connection) -> Vec<String> {
    let mut statement = conn
        .prepare("SELECT title FROM item ORDER BY title")
        .unwrap();
    statement
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn found(conn: &Connection, word: &str) -> i64 {
    conn.query_row(
        "SELECT count(*) FROM search_fts WHERE search_fts MATCH ?1",
        [word],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn a_restored_backup_restores_everything_and_nothing_else() {
    let scratch = Scratch::new("restore");
    let mut conn = scratch.open();

    let kept = add(&mut conn, "Pay rent");
    items::set_completed(&conn, &kept, true).unwrap();
    let settings_before = settings::set(
        &conn,
        &settings::Settings {
            theme: "dark".into(),
            ..settings::Settings::default()
        },
    )
    .unwrap();

    let taken = backup::create(&conn, &scratch.dir).unwrap();
    assert!(PathBuf::from(&taken.path).exists());
    assert_eq!(backup::list(&scratch.dir).unwrap().len(), 1);

    // Life goes on after the backup: one more task, one deleted.
    add(&mut conn, "Written after the backup");
    items::delete_item(&mut conn, &kept).unwrap();
    assert_eq!(titles(&conn), vec!["Written after the backup"]);
    assert_eq!(found(&conn, "rent"), 0);

    let version = backup::restore(&mut conn, &scratch.dir, &PathBuf::from(&taken.path)).unwrap();
    assert_eq!(version, migrations::target_version());

    // Exactly the backed-up state: the row, its completion, the index, the settings.
    assert_eq!(titles(&conn), vec!["Pay rent"]);
    assert!(items::get_item(&conn, &kept)
        .unwrap()
        .completed_at
        .is_some());
    assert_eq!(found(&conn, "rent"), 1);
    assert_eq!(found(&conn, "written"), 0);
    assert_eq!(settings::get(&conn).unwrap(), settings_before);

    // The restore took a safety backup first, so it can itself be undone.
    assert_eq!(backup::list(&scratch.dir).unwrap().len(), 2);

    // And the connection is still a working, migrated, WAL database.
    let journal: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(journal.to_lowercase(), "wal");
    add(&mut conn, "Still writable");
}

#[test]
fn a_file_that_is_not_a_workspace_is_refused_before_anything_changes() {
    let scratch = Scratch::new("refuse");
    let mut conn = scratch.open();
    add(&mut conn, "Keep me");

    let bogus = scratch.dir.join("notes.sqlite3");
    fs::write(&bogus, b"this is not a database").unwrap();
    let error = backup::restore(&mut conn, &scratch.dir, &bogus).unwrap_err();
    assert!(matches!(error, tessera_lib::error::Error::InvalidInput(_)));

    let empty = Connection::open(scratch.dir.join("empty.sqlite3")).unwrap();
    empty.execute_batch("CREATE TABLE t (x)").unwrap();
    drop(empty);
    let error =
        backup::restore(&mut conn, &scratch.dir, &scratch.dir.join("empty.sqlite3")).unwrap_err();
    assert!(matches!(error, tessera_lib::error::Error::InvalidInput(_)));

    assert_eq!(titles(&conn), vec!["Keep me"]);
    // No safety backup was taken for a refused file.
    assert_eq!(backup::list(&scratch.dir).unwrap().len(), 0);
}

#[test]
fn rotation_keeps_the_newest_and_the_daily_check_knows_today() {
    let scratch = Scratch::new("rotate");
    let conn = scratch.open();
    assert!(backup::due_today(&scratch.dir));

    // Backups are named to the second; spread them out by hand.
    let folder = backup::folder(&scratch.dir);
    fs::create_dir_all(&folder).unwrap();
    for stamp in ["20260901T090000Z", "20260902T090000Z", "20260903T090000Z"] {
        let path = folder.join(format!("tessera-{stamp}.sqlite3"));
        conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
            .unwrap();
    }
    fs::write(folder.join("unrelated.txt"), b"not a backup").unwrap();

    let listed = backup::list(&scratch.dir).unwrap();
    assert_eq!(listed.len(), 3);
    assert_eq!(listed[0].file_name, "tessera-20260903T090000Z.sqlite3");

    assert_eq!(backup::rotate(&scratch.dir, 2).unwrap(), 1);
    let after = backup::list(&scratch.dir).unwrap();
    assert_eq!(after.len(), 2);
    assert!(after
        .iter()
        .all(|b| b.file_name != "tessera-20260901T090000Z.sqlite3"));
    assert!(folder.join("unrelated.txt").exists());

    // A backup taken now means today is done.
    backup::create(&conn, &scratch.dir).unwrap();
    assert!(!backup::due_today(&scratch.dir));
}

#[test]
fn an_export_file_round_trips_through_import() {
    let scratch = Scratch::new("export");
    let mut conn = scratch.open();
    let id = add(&mut conn, "Buy milk");
    items::set_completed(&conn, &id, true).unwrap();

    let file = scratch.dir.join("export.json");
    let counts = export::export_to_file(&conn, &file).unwrap();
    assert_eq!(counts.items, 1);

    add(&mut conn, "Not in the export");
    let document = export::read_export(&file).unwrap();
    let imported = export::import(&mut conn, &document).unwrap();
    assert_eq!(imported.items, 1);
    assert_eq!(titles(&conn), vec!["Buy milk"]);
    assert_eq!(found(&conn, "milk"), 1);

    // A file from another program is refused as a sentence.
    fs::write(&file, "{\"hello\": 1}").unwrap();
    assert!(matches!(
        export::read_export(&file).unwrap_err(),
        tessera_lib::error::Error::InvalidInput(_)
    ));
}
