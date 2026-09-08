-- ── Imports ────────────────────────────────────────────────────────────────
-- An import is one thing to the person who pressed the button, so it is one
-- thing here: a batch, and the rows the batch created, in the order it created
-- them. Undoing the import removes exactly those rows and nothing else — which
-- is only possible because they were written down at the time.
--
-- `import_row` names rows by table and id rather than with foreign keys, because
-- it spans several tables and outlives none of them: when a row is deleted by
-- hand later, its entry here stays as history and undo simply finds nothing to
-- remove.

CREATE TABLE import_batch (
    id           TEXT PRIMARY KEY,
    source       TEXT NOT NULL,          -- "a Tessera export", "a Todoist export"…
    imported_at  TEXT NOT NULL,
    summary_json TEXT NOT NULL           -- counts, for the list; the rows below are the truth
);

CREATE TABLE import_row (
    batch_id   TEXT NOT NULL REFERENCES import_batch (id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,          -- creation order; undo walks it backwards
    table_name TEXT NOT NULL CHECK (table_name IN ('collection', 'item', 'block', 'event')),
    row_id     TEXT NOT NULL,
    PRIMARY KEY (batch_id, seq)
);

CREATE INDEX idx_import_row_target ON import_row (table_name, row_id);
