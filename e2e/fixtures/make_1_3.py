"""Build e2e/fixtures/workspace-1.3.0.sqlite3 — a workspace as 1.3.0 left it.

The 1.4 release's proof of done is that a 1.3 workspace opens in 1.4, migrated,
without loss. 1.3.0 shipped migrations 001–018; this script applies exactly those,
in order, bumping `workspace.schema_version` as the host does, and then writes what
using 1.3 would leave behind — all synthetic:

- three tasks with estimates and due dates, one finished, one dependency;
- a reminder on the first, in the one way 1.3 had of setting one;
- an hour tracked against the first;
- a page, "Handover", whose text is a paragraph;
- a goal, "Launch", with a weekly envelope, counting two of the tasks;
- a day off.

    python e2e/fixtures/make_1_3.py
"""

import pathlib
import sqlite3

HERE = pathlib.Path(__file__).resolve().parent
MIGRATIONS = HERE.parent.parent / "src-tauri" / "migrations"
OUT = HERE / "workspace-1.3.0.sqlite3"
SHIPPED = 18  # migrations in 1.3.0
STAMP = "2026-11-02T10:00:00.000Z"
REMIND = "2027-12-01T16:00:00.000Z"


def main() -> None:
    if OUT.exists():
        OUT.unlink()
    db = sqlite3.connect(OUT)
    db.execute("PRAGMA foreign_keys = ON")
    files = sorted(MIGRATIONS.glob("*.sql"))[:SHIPPED]
    assert files[-1].name.startswith("018_"), files[-1].name
    for version, path in enumerate(files, start=1):
        db.executescript(path.read_text(encoding="utf-8"))
        db.execute("UPDATE workspace SET schema_version = ? WHERE id = 1", (version,))
    db.commit()

    (collection,) = db.execute("SELECT id FROM collection ORDER BY position LIMIT 1").fetchone()
    tasks = [
        ("t-plan", "Plan the launch", "a0", 240, "2027-12-01T17:00:00.000Z", None),
        ("t-write", "Write the notes", "a1", 180, "2027-12-03T17:00:00.000Z", None),
        ("t-old", "Book the room", "a2", 30, "2026-10-25T17:00:00.000Z", "2026-10-24T12:00:00.000Z"),
    ]
    for item_id, title, position, estimate, due, done in tasks:
        db.execute(
            "INSERT INTO item (id, collection_id, title, position, estimate_minutes, due_at, "
            "completed_at, created_at, updated_at, is_milestone) VALUES (?,?,?,?,?,?,?,?,?,0)",
            (item_id, collection, title, position, estimate, due, done, STAMP, STAMP),
        )
    db.execute(
        "INSERT INTO item_dependency (blocker_id, blocked_id, created_at) VALUES ('t-plan', 't-write', ?)",
        (STAMP,),
    )
    db.execute("UPDATE item SET remind_at = ? WHERE id = 't-plan'", (REMIND,))
    db.execute(
        "INSERT INTO reminder (id, owner_kind, owner_id, fire_at, kind) "
        "VALUES ('r-plan', 'item', 't-plan', ?, 'absolute')",
        (REMIND,),
    )
    db.execute(
        "INSERT INTO time_entry (id, item_id, started_at, ended_at, created_at) VALUES "
        "('e1', 't-plan', '2026-10-26T13:00:00.000Z', '2026-10-26T14:00:00.000Z', ?)",
        (STAMP,),
    )
    db.execute(
        "INSERT INTO page (id, title, title_key, position, created_at, updated_at) "
        "VALUES ('p-handover', 'Handover', 'handover', 'a0', ?, ?)",
        (STAMP, STAMP),
    )
    db.execute(
        "INSERT INTO block (id, owner_kind, owner_id, type, position, content_json, created_at, updated_at) "
        "VALUES ('b1', 'page', 'p-handover', 'paragraph', 'a0', "
        "'{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Everything 1.3 wrote.\"}]}', ?, ?)",
        (STAMP, STAMP),
    )
    db.execute(
        "INSERT INTO goal (id, name, measure, target, due_day, position, created_at, updated_at, "
        "weekly_minutes) VALUES ('g-launch', 'Launch', 'tasks', 2, '2027-12-31', 'm', ?, ?, 300)",
        (STAMP, STAMP),
    )
    for item_id in ["t-plan", "t-write"]:
        db.execute("INSERT INTO goal_item (goal_id, item_id) VALUES ('g-launch', ?)", (item_id,))
    db.execute(
        "INSERT INTO day_off (day, label, created_at) VALUES ('2027-12-24', 'Holiday', ?)",
        (STAMP,),
    )
    db.commit()

    (version,) = db.execute("SELECT schema_version FROM workspace WHERE id = 1").fetchone()
    assert version == SHIPPED, version
    db.execute("VACUUM")
    db.close()
    print(f"{OUT.name}: schema {version}")


if __name__ == "__main__":
    main()
