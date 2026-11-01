"""Build e2e/fixtures/workspace-split.sqlite3 — a past week with plans and life (M6).

The split tile reads a past hour that was set aside for a task (a time block)
against what was tracked in it. That needs a week that is over, with blocks and
time entries in it, which no end-to-end test can make by clicking. This script
writes it the way the application would: the project's own migrations, in
order, then the rows.

    python e2e/fixtures/make_split.py

The week of Monday 26 October 2026, all instants in UTC and inside the default
working day both in UTC (the CI runner) and in America/Sao_Paulo (UTC-3):

- Monday 12:00–14:00 is a block for "Draft chapter". 12:00–13:00 tracked on
  "Draft chapter" — closes. 13:00–14:00 tracked on "Email the team" — split.
- Tuesday 13:00–14:00 is a block for "Draft chapter", nothing tracked — split.
- Wednesday 15:00–16:00 tracked on "Email the team", no block — not a split
  tile at all.

So: three hours set aside, one closed, two that did not.
"""

import pathlib
import sqlite3

HERE = pathlib.Path(__file__).resolve().parent
MIGRATIONS = HERE.parent.parent / "src-tauri" / "migrations"
OUT = HERE / "workspace-split.sqlite3"
STAMP = "2026-10-20T10:00:00.000Z"


def main() -> None:
    if OUT.exists():
        OUT.unlink()
    db = sqlite3.connect(OUT)
    db.execute("PRAGMA foreign_keys = ON")
    for version, path in enumerate(sorted(MIGRATIONS.glob("*.sql")), start=1):
        db.executescript(path.read_text(encoding="utf-8"))
        db.execute("UPDATE workspace SET schema_version = ? WHERE id = 1", (version,))
    db.commit()

    (collection,) = db.execute("SELECT id FROM collection ORDER BY position LIMIT 1").fetchone()
    for item_id, title, position, estimate in [
        ("draft", "Draft chapter", "a0", 600),
        ("email", "Email the team", "a1", None),
    ]:
        db.execute(
            "INSERT INTO item (id, collection_id, title, position, estimate_minutes, "
            "created_at, updated_at, is_milestone) VALUES (?,?,?,?,?,?,?,0)",
            (item_id, collection, title, position, estimate, STAMP, STAMP),
        )

    def block(event_id: str, starts: str, ends: str) -> None:
        db.execute(
            "INSERT INTO event (id, calendar_id, title, starts_at_utc, ends_at_utc, tz, "
            "created_at, updated_at) VALUES (?, 'personal', 'Draft chapter', ?, ?, 'UTC', ?, ?)",
            (event_id, starts, ends, STAMP, STAMP),
        )
        db.execute(
            "INSERT INTO time_block (id, item_id, event_id, created_at) VALUES (?, 'draft', ?, ?)",
            (f"tb-{event_id}", event_id, STAMP),
        )

    block("mon", "2026-10-26T12:00:00.000Z", "2026-10-26T14:00:00.000Z")
    block("tue", "2026-10-27T13:00:00.000Z", "2026-10-27T14:00:00.000Z")

    for entry_id, item_id, started, ended in [
        ("e1", "draft", "2026-10-26T12:00:00.000Z", "2026-10-26T13:00:00.000Z"),
        ("e2", "email", "2026-10-26T13:00:00.000Z", "2026-10-26T14:00:00.000Z"),
        ("e3", "email", "2026-10-28T15:00:00.000Z", "2026-10-28T16:00:00.000Z"),
    ]:
        db.execute(
            "INSERT INTO time_entry (id, item_id, started_at, ended_at, created_at) "
            "VALUES (?,?,?,?,?)",
            (entry_id, item_id, started, ended, STAMP),
        )
    db.commit()
    (version,) = db.execute("SELECT schema_version FROM workspace WHERE id = 1").fetchone()
    db.execute("VACUUM")
    db.close()
    print(f"{OUT.name}: schema {version}, 2 blocks, 3 entries")


if __name__ == "__main__":
    main()
