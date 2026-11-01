-- 1.3, M5: envelopes.
--
-- A goal may hold a weekly budget of working minutes — an envelope of tiles
-- in the week mosaic (M4). Null is a goal with no envelope, which is every
-- goal before this migration and most goals after it.
--
-- The budget is a promise, not a limit: going over it is recorded, never
-- refused (SPEC 1.3). It is stored in minutes, like every number the mosaic
-- shows (ADR-037).

ALTER TABLE goal ADD COLUMN weekly_minutes INTEGER
    CHECK (weekly_minutes IS NULL OR (weekly_minutes > 0 AND weekly_minutes <= 10080));
