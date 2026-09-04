-- ── Time tracked ───────────────────────────────────────────────────────────
-- An interval against a task: when it started, when it stopped. A running
-- timer is a row whose `ended_at` is still null, which is why a timer survives
-- a restart without anything having to remember it — the row is the memory.
--
-- The rule worth putting in the schema rather than in the application: **at
-- most one timer runs at a time**. A partial unique index over a constant
-- expression says exactly that. Every running row indexes the same key, so the
-- second one collides; a stopped row leaves the index entirely.
--
-- Doing it here rather than in Rust means it holds against every path — a
-- future import, a repair script, a command written in a hurry — instead of
-- only against the one that remembered to check.

CREATE TABLE time_entry (
    id         TEXT PRIMARY KEY,
    item_id    TEXT NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,          -- UTC (ADR-013)
    ended_at   TEXT,                   -- null while it runs
    created_at TEXT NOT NULL,

    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX idx_one_timer_running ON time_entry ((1)) WHERE ended_at IS NULL;

-- "How long has this task taken" is asked every time a task is opened.
CREATE INDEX idx_time_entry_item ON time_entry (item_id, started_at);

-- "What did I do this week" walks a range of starts.
CREATE INDEX idx_time_entry_started ON time_entry (started_at);
