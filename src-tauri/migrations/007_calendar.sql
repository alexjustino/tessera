-- Tessera — migration 007: time.
--
-- An item is a unit of work; an event is a unit of time (ADR-008). They are
-- different tables because an event has a start *and* an end, a timezone, and
-- recurring occurrences with per-occurrence exceptions — none of which fits an
-- entity-attribute-value property bag without making the calendar slow and the
-- task model muddy.
--
-- What they share is the half that matters: the same block editor, the same
-- reminder pipeline, the same search index, the same activity trail. And
-- `time_block` bridges them, which is the product's differentiator — dragging a
-- task onto the grid reserves time for it while it stays the same task.

CREATE TABLE calendar (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    color    TEXT,
    visible  INTEGER NOT NULL DEFAULT 1,
    position TEXT NOT NULL
);

INSERT INTO calendar (id, name, color, visible, position)
VALUES ('personal', 'Personal', 'accent', 1, 'V');

CREATE TABLE event (
    id            TEXT PRIMARY KEY,
    calendar_id   TEXT NOT NULL REFERENCES calendar (id) ON DELETE CASCADE,
    title         TEXT NOT NULL DEFAULT '',
    location      TEXT,

    -- UTC instants (ADR-013). The zone is kept alongside because a recurring
    -- 09:00 meeting must stay 09:00 after the clocks change, and that cannot be
    -- recovered from an instant alone.
    starts_at_utc TEXT NOT NULL,
    ends_at_utc   TEXT NOT NULL,
    tz            TEXT NOT NULL,

    -- The one declared exception to storing UTC: an all-day event is a local
    -- date with no time, and giving it an instant would move it across the
    -- date line for anyone west of Greenwich.
    all_day       INTEGER NOT NULL DEFAULT 0,

    rrule         TEXT,
    busy          INTEGER NOT NULL DEFAULT 1,
    private       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,

    CHECK (ends_at_utc >= starts_at_utc)
);

CREATE INDEX idx_event_window ON event (starts_at_utc, ends_at_utc);
CREATE INDEX idx_event_calendar ON event (calendar_id);

-- One occurrence of a series, moved or cancelled.
--
-- This is what separates a calendar that works from one that almost does.
-- "Cancel just this Tuesday" and "move only next Thursday to 15:00" are the
-- two things every person expects and every naive implementation cannot say.
CREATE TABLE event_exception (
    event_id            TEXT NOT NULL REFERENCES event (id) ON DELETE CASCADE,
    original_start_utc  TEXT NOT NULL,
    kind                TEXT NOT NULL CHECK (kind IN ('cancelled', 'moved')),
    starts_at_utc       TEXT,
    ends_at_utc         TEXT,
    PRIMARY KEY (event_id, original_start_utc)
);

-- The bridge. A task reserved on the calendar is still the same task: the
-- event carries the time, the item carries the work, and this row says they
-- are the same thing.
CREATE TABLE time_block (
    id         TEXT PRIMARY KEY,
    item_id    TEXT NOT NULL REFERENCES item (id)  ON DELETE CASCADE,
    event_id   TEXT NOT NULL REFERENCES event (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE (event_id)
);

CREATE INDEX idx_time_block_item ON time_block (item_id);

-- Working hours, for shading the grid and for the capacity figures in 1.1.
-- Stored as local wall-clock minutes from midnight: they are a statement about
-- a working day, not about an instant.
CREATE TABLE work_hours (
    weekday       INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
    starts_minute INTEGER NOT NULL,
    ends_minute   INTEGER NOT NULL,
    CHECK (ends_minute > starts_minute)
);

INSERT INTO work_hours (weekday, starts_minute, ends_minute) VALUES
    (1, 540, 1080), (2, 540, 1080), (3, 540, 1080), (4, 540, 1080), (5, 540, 1080);

-- The calendar view itself, over the same items and events.
INSERT INTO view (id, collection_id, name, kind, config_json, position)
SELECT
    'view.calendar',
    NULL,
    'Calendar',
    'calendar',
    json('{
      "filters": [],
      "match": "all",
      "sorts": [],
      "groupBy": null,
      "includeCompleted": true
    }'),
    'f'
WHERE NOT EXISTS (SELECT 1 FROM view WHERE id = 'view.calendar');
