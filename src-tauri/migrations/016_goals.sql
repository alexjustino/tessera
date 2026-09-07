-- Tessera — migration 016: goals.
--
-- A goal is an intention with a finish line: a name, a number to reach, and
-- optionally a day to reach it by. What counts towards it is not a filter the
-- product guesses at — it is the tasks a person put in it, one by one, the way
-- dependencies are made (ADR-030). That is what lets the progress open onto the
-- rows it came from (ADR-024): every row is a task somebody chose.

CREATE TABLE goal (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,

    -- What the number means: tasks finished, or minutes tracked against them.
    -- Both are counted from rows that already exist; a goal stores no totals
    -- of its own, so it can never disagree with the work.
    measure    TEXT NOT NULL CHECK (measure IN ('tasks', 'minutes')),
    target     INTEGER NOT NULL CHECK (target > 0),

    -- A local day, not an instant: "by the 31st" is a date on a calendar, and
    -- giving it a time would move it for anyone west of Greenwich (ADR-013).
    due_day    TEXT,

    position   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_goal_position ON goal (position);

-- One task counting towards one goal.
--
-- Cascades from both sides: deleting a goal forgets its rows, and deleting a
-- task takes it out of every goal it counted for — a goal that counted a task
-- nobody can open would be a number with no rows behind it.
CREATE TABLE goal_item (
    goal_id TEXT NOT NULL REFERENCES goal (id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    PRIMARY KEY (goal_id, item_id)
);

CREATE INDEX idx_goal_item_item ON goal_item (item_id);
