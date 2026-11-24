-- 1.4, the daily ritual: each day planned in the morning and closed at night.
--
-- One row per local day. `planned_at` is set by Plan my day and `closed_at` by Close the
-- day; the counts and the score are what the day came to when it was closed, kept as a
-- record so the days can be read back as a history, which a score computed live cannot
-- give once the day has gone. The line a person writes about the day is kept here and in
-- the Journal page of Notes.

CREATE TABLE day_review (
    day             TEXT PRIMARY KEY,          -- local day, YYYY-MM-DD
    planned_at      TEXT,
    closed_at       TEXT,
    score           INTEGER,                   -- 0..100, null when nothing could be measured
    done            INTEGER NOT NULL DEFAULT 0,
    carried         INTEGER NOT NULL DEFAULT 0, -- moved to the next day when it was closed
    tracked_minutes INTEGER NOT NULL DEFAULT 0,
    note            TEXT
);
