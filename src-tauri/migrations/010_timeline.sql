-- ── The timeline ───────────────────────────────────────────────────────────
-- A fifth kind of view, which means widening a CHECK constraint.
--
-- SQLite cannot alter a constraint in place, so the table is rebuilt: a new
-- one, the rows copied, the old dropped, the new renamed. That is the
-- documented way, and it is why the constraint is worth arguing about before
-- it is written — this migration exists because 001 named four kinds instead
-- of leaving the column open.
--
-- Foreign keys are deferred for the swap by the migration runner's transaction:
-- `view.collection_id` points at `collection`, and nothing points at `view`, so
-- no other table needs rewriting.

CREATE TABLE view_new (
    id            TEXT PRIMARY KEY,
    collection_id TEXT REFERENCES collection (id) ON DELETE CASCADE,  -- NULL = cross-collection
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('list', 'table', 'board', 'calendar', 'timeline')),
    config_json   TEXT NOT NULL DEFAULT '{}',
    position      TEXT NOT NULL
);

INSERT INTO view_new (id, collection_id, name, kind, config_json, position)
SELECT id, collection_id, name, kind, config_json, position FROM view;

DROP TABLE view;
ALTER TABLE view_new RENAME TO view;

-- The seeded timeline: the same query as the list, drawn against dates.
--
-- `includeCompleted` is true because a plan is a statement about the whole of
-- the work, finished parts included — a timeline that hid what was done would
-- redraw itself every time something was ticked.
INSERT INTO view (id, collection_id, name, kind, config_json, position)
SELECT
    'tasks.timeline',
    'tasks',
    'Timeline',
    'timeline',
    json('{
      "filters": [],
      "match": "all",
      "sorts": [],
      "groupBy": null,
      "includeCompleted": true
    }'),
    'g'
WHERE NOT EXISTS (SELECT 1 FROM view WHERE id = 'tasks.timeline');
