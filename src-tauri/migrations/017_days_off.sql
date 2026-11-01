-- 1.3, M3: days off.
--
-- A holiday, a day of leave, a closed office: a day that is in the working
-- week (work_hours) but has no working hours this time. Capacity reads it
-- everywhere — the year, the day, the receipt, the mosaic — so a public holiday
-- on a Tuesday stops having nine hours (ADR-023's stated gap).
--
-- One row per local day. The label is what the person called it ("Christmas",
-- "Dentist, whole day"); it may be empty. A day off is not an event: it carries
-- no time, belongs to no calendar, and does not repeat — next year's holiday is
-- next year's row.

CREATE TABLE day_off (
    day        TEXT PRIMARY KEY
               CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    label      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
