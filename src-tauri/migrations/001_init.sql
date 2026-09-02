-- Tessera — migration 001: the workspace and the typed work core.
--
-- Migrations are forward-only and numbered. `workspace.schema_version` records
-- the highest migration applied. A release that adds a migration must be
-- covered by a round-trip test that opens a database at version N-1 and
-- migrates it without loss.
--
-- Naming: every timestamp column is UTC (ADR-013). Local wall-clock time is
-- never stored, with the single declared exception of all-day events, which
-- arrive in migration 002 together with the calendar.

PRAGMA foreign_keys = ON;

-- ── Workspace ──────────────────────────────────────────────────────────────
CREATE TABLE workspace (
    id             INTEGER PRIMARY KEY CHECK (id = 1),   -- single row, by design
    name           TEXT    NOT NULL DEFAULT 'Tessera',
    settings_json  TEXT    NOT NULL DEFAULT '{}',
    schema_version INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO workspace (id) VALUES (1);

-- ── Collections ────────────────────────────────────────────────────────────
-- A collection is what Notion calls a database, Trello calls a board and
-- To Do calls a list. One concept, so that one view engine serves all three.
CREATE TABLE collection (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    icon        TEXT,
    color       TEXT,
    position    TEXT NOT NULL,                            -- fractional index (ADR-006)
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    archived_at TEXT
);

CREATE INDEX idx_collection_position ON collection (position)
    WHERE archived_at IS NULL;

-- ── Items ──────────────────────────────────────────────────────────────────
-- An item is a unit of work. An event (migration 002) is a unit of time.
-- They are deliberately different tables — see ADR-008.
CREATE TABLE item (
    id               TEXT NOT NULL PRIMARY KEY,
    collection_id    TEXT NOT NULL REFERENCES collection (id) ON DELETE CASCADE,
    parent_item_id   TEXT REFERENCES item (id) ON DELETE CASCADE,
    title            TEXT NOT NULL DEFAULT '',
    position         TEXT NOT NULL,                       -- fractional index
    status_id        TEXT,
    start_at         TEXT,                                -- UTC
    due_at           TEXT,                                -- UTC
    remind_at        TEXT,                                -- UTC
    estimate_minutes INTEGER,
    recurrence_rrule TEXT,                                -- RFC 5545
    recurrence_mode  TEXT CHECK (recurrence_mode IN ('schedule', 'after_completion')),
    completed_at     TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    archived_at      TEXT
);

CREATE INDEX idx_item_collection ON item (collection_id, position)
    WHERE archived_at IS NULL;
CREATE INDEX idx_item_parent     ON item (parent_item_id);
CREATE INDEX idx_item_due        ON item (due_at)    WHERE completed_at IS NULL;
CREATE INDEX idx_item_remind     ON item (remind_at) WHERE remind_at IS NOT NULL;

-- ── Properties ─────────────────────────────────────────────────────────────
CREATE TABLE property (
    id            TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collection (id) ON DELETE CASCADE,
    key           TEXT NOT NULL,
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,
    config_json   TEXT NOT NULL DEFAULT '{}',
    position      TEXT NOT NULL,
    is_system     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (collection_id, key)
);

-- Entity-attribute-value. The trade-off is deliberate and documented in
-- ADR-005: filtering happens in memory, so the classic EAV query cost does not
-- apply, and the user gains properties that appear and disappear without DDL.
CREATE TABLE item_property_value (
    item_id     TEXT NOT NULL REFERENCES item (id)     ON DELETE CASCADE,
    property_id TEXT NOT NULL REFERENCES property (id) ON DELETE CASCADE,
    value_json  TEXT NOT NULL,
    PRIMARY KEY (item_id, property_id)
);

CREATE INDEX idx_ipv_property ON item_property_value (property_id);

-- ── Tags ───────────────────────────────────────────────────────────────────
CREATE TABLE tag (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    color TEXT
);

CREATE TABLE item_tag (
    item_id TEXT NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tag (id)  ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX idx_item_tag_tag ON item_tag (tag_id);

-- ── Blocks ─────────────────────────────────────────────────────────────────
-- One editor serves items, events and pages: `owner_kind` says which.
CREATE TABLE block (
    id              TEXT PRIMARY KEY,
    owner_kind      TEXT NOT NULL CHECK (owner_kind IN ('item', 'event', 'page')),
    owner_id        TEXT NOT NULL,
    parent_block_id TEXT REFERENCES block (id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    position        TEXT NOT NULL,
    content_json    TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX idx_block_owner  ON block (owner_kind, owner_id, position);
CREATE INDEX idx_block_parent ON block (parent_block_id);

-- ── Views ──────────────────────────────────────────────────────────────────
CREATE TABLE view (
    id            TEXT PRIMARY KEY,
    collection_id TEXT REFERENCES collection (id) ON DELETE CASCADE,  -- NULL = cross-collection
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('list', 'table', 'board', 'calendar')),
    config_json   TEXT NOT NULL DEFAULT '{}',
    position      TEXT NOT NULL
);

-- ── Reminders ──────────────────────────────────────────────────────────────
-- A single alert pipeline serves items and events alike; the scheduler sleeps
-- until the next `fire_at` rather than polling.
CREATE TABLE reminder (
    id            TEXT PRIMARY KEY,
    owner_kind    TEXT NOT NULL CHECK (owner_kind IN ('item', 'event')),
    owner_id      TEXT NOT NULL,
    fire_at       TEXT NOT NULL,                          -- UTC
    kind          TEXT NOT NULL DEFAULT 'absolute',
    fired_at      TEXT,
    dismissed_at  TEXT,
    snoozed_until TEXT
);

CREATE INDEX idx_reminder_pending ON reminder (fire_at)
    WHERE fired_at IS NULL AND dismissed_at IS NULL;

-- ── Activity ───────────────────────────────────────────────────────────────
CREATE TABLE activity (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_kind   TEXT NOT NULL,
    owner_id     TEXT NOT NULL,
    kind         TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    at           TEXT NOT NULL
);

CREATE INDEX idx_activity_owner ON activity (owner_kind, owner_id, at);

-- ── Full-text search ───────────────────────────────────────────────────────
-- External-content-free: rows are written by the repository, which flattens a
-- block document to plain text. Keeping it standalone avoids the trigger web
-- that external-content FTS needs across four owner tables.
CREATE VIRTUAL TABLE search_fts USING fts5 (
    owner_kind UNINDEXED,
    owner_id   UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);
