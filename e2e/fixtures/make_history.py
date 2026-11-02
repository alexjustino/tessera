"""Build e2e/fixtures/workspace-history.sqlite3 — a workspace with estimate history.

The confidence range (M2) appears only above a sample of finished tasks that
have both an estimate and tracked time. Typing ten of them through WebDriver
would test the typing, not the range, so this script writes the workspace the
way the application would: it applies the project's own migrations, in order,
bumping `workspace.schema_version` as the host does, then adds the rows.

    python e2e/fixtures/make_history.py

The rows, all synthetic:

- ten finished one-hour tasks ("Past task 1".."Past task 10") whose tracked
  time was 60 ×5, 90 ×3 and 120 ×2 minutes — ratios 1, 1.5 and 2; median 1.25,
  85th percentile 1.825 (the same history `confidence.test.ts` reasons about);
- one open task, "Write the launch notes", estimated at sixteen hours;
- one goal, "Launch", counting that task, due at the end of June 2027.
"""

import pathlib
import sqlite3

HERE = pathlib.Path(__file__).resolve().parent
MIGRATIONS = HERE.parent.parent / "src-tauri" / "migrations"
OUT = HERE / "workspace-history.sqlite3"

TOOK = [60, 60, 60, 60, 60, 90, 90, 90, 120, 120]
STAMP = "2026-10-01T10:00:00.000Z"


def main() -> None:
    if OUT.exists():
        OUT.unlink()
    db = sqlite3.connect(OUT)
    db.execute("PRAGMA foreign_keys = ON")

    files = sorted(MIGRATIONS.glob("*.sql"))
    for version, path in enumerate(files, start=1):
        db.executescript(path.read_text(encoding="utf-8"))
        db.execute("UPDATE workspace SET schema_version = ? WHERE id = 1", (version,))
    db.commit()

    (collection,) = db.execute("SELECT id FROM collection ORDER BY position LIMIT 1").fetchone()

    def task(item_id: str, title: str, position: str, estimate: int, completed: str | None) -> None:
        db.execute(
            "INSERT INTO item (id, collection_id, title, position, estimate_minutes, "
            "completed_at, created_at, updated_at, is_milestone) VALUES (?,?,?,?,?,?,?,?,0)",
            (item_id, collection, title, position, estimate, completed, STAMP, STAMP),
        )

    for i, minutes in enumerate(TOOK, start=1):
        item_id = f"past-{i:02d}"
        task(item_id, f"Past task {i}", f"a{i:02d}", 60, "2026-10-20T16:00:00.000Z")
        started = f"2026-10-20T{8 + i % 8:02d}:00:00.000Z"
        end_minutes = (8 + i % 8) * 60 + minutes
        ended = f"2026-10-20T{end_minutes // 60:02d}:{end_minutes % 60:02d}:00.000Z"
        db.execute(
            "INSERT INTO time_entry (id, item_id, started_at, ended_at, created_at) VALUES (?,?,?,?,?)",
            (f"entry-{i:02d}", item_id, started, ended, STAMP),
        )

    task("launch-notes", "Write the launch notes", "b00", 16 * 60, None)
    db.execute(
        "INSERT INTO goal (id, name, measure, target, due_day, position, created_at, updated_at) "
        "VALUES ('goal-launch', 'Launch', 'tasks', 1, '2027-06-30', 'm', ?, ?)",
        (STAMP, STAMP),
    )
    db.execute("INSERT INTO goal_item (goal_id, item_id) VALUES ('goal-launch', 'launch-notes')")
    db.commit()

    (version,) = db.execute("SELECT schema_version FROM workspace WHERE id = 1").fetchone()
    db.execute("VACUUM")
    db.close()
    print(f"{OUT.name}: schema {version}, {len(TOOK)} finished tasks with history")


if __name__ == "__main__":
    main()
