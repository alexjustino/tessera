-- ── Imports remember what they changed, not only what they made ─────────────
-- A3 lets an import create a property and extend another's options (a Trello
-- list becomes a column of the Status property). Two things follow: the row
-- kinds an import can touch gain 'property', and undo must put an extended
-- property back exactly, so the row that records the change keeps the
-- configuration as it was. SQLite cannot widen a CHECK in place, so the table
-- is rebuilt with its rows — the same care migration 010 took with `view`.

CREATE TABLE import_row_next (
    batch_id    TEXT NOT NULL REFERENCES import_batch (id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    table_name  TEXT NOT NULL CHECK (table_name IN ('collection', 'item', 'block', 'event', 'property')),
    row_id      TEXT NOT NULL,
    before_json TEXT,                     -- the row as it was, for a change; null for a creation
    PRIMARY KEY (batch_id, seq)
);

INSERT INTO import_row_next (batch_id, seq, table_name, row_id, before_json)
SELECT batch_id, seq, table_name, row_id, NULL FROM import_row;

DROP TABLE import_row;
ALTER TABLE import_row_next RENAME TO import_row;

CREATE INDEX idx_import_row_target ON import_row (table_name, row_id);
