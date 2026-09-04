-- ── Dependencies ───────────────────────────────────────────────────────────
-- One edge, one meaning: `blocker_id` must be finished before `blocked_id` may
-- start. The direction is stated in the column names rather than left to a
-- convention somebody has to remember, because a dependency graph read
-- backwards is worse than no graph at all.
--
-- A task blocking itself is refused by the table. A longer loop cannot be
-- expressed as a constraint — it is a question about reachability — so the
-- repository asks it with a recursive query before every insert (ADR-019).
--
-- No `strength` column, no lag, no start-to-start or finish-to-finish. One
-- relation that means one thing; the rest is 1.2's problem if anybody wants it.

CREATE TABLE item_dependency (
    blocker_id TEXT NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,

    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

-- The primary key indexes `blocker_id`; "what is holding this up" reads the
-- other way and is the question the task detail asks on every open.
CREATE INDEX idx_dependency_blocked ON item_dependency (blocked_id);
