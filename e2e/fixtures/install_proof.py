"""The two ends of the Install proof workflow: seed a 1.2 workspace, check it after.

    python e2e/fixtures/install_proof.py seed  <workspace file>
    python e2e/fixtures/install_proof.py check <workspace file>

`seed` runs on the workspace the published 1.2.0 made, and writes one task the
way the application would. `check` exits 0 only when that task is still there
and the workspace is at the schema this checkout ships — so an upgrade that
loses a row, or that does not migrate, fails the workflow.
"""

import pathlib
import sqlite3
import sys

MIGRATIONS = pathlib.Path(__file__).resolve().parent.parent.parent / "src-tauri" / "migrations"
TITLE = "Written by 1.2.0"


def seed(path: str) -> int:
    db = sqlite3.connect(path)
    (version,) = db.execute("SELECT schema_version FROM workspace WHERE id = 1").fetchone()
    if version != 16:
        print(f"expected 1.2.0 to leave schema 16, found {version}")
        return 1
    (collection,) = db.execute("SELECT id FROM collection ORDER BY position LIMIT 1").fetchone()
    stamp = "2026-10-01T10:00:00.000Z"
    db.execute(
        "INSERT INTO item (id, collection_id, title, position, created_at, updated_at, is_milestone) "
        "VALUES ('install-proof', ?, ?, 'zz', ?, ?, 0)",
        (collection, TITLE, stamp, stamp),
    )
    db.commit()
    print(f"seeded at schema {version}")
    return 0


def check(path: str) -> int:
    wanted = len(list(MIGRATIONS.glob("*.sql")))
    db = sqlite3.connect(path)
    (version,) = db.execute("SELECT schema_version FROM workspace WHERE id = 1").fetchone()
    rows = db.execute("SELECT count(*) FROM item WHERE title = ?", (TITLE,)).fetchone()[0]
    print(f"schema {version} of {wanted}; task rows {rows}")
    return 0 if version == wanted and rows == 1 else 1


if __name__ == "__main__":
    sys.exit({"seed": seed, "check": check}[sys.argv[1]](sys.argv[2]))
