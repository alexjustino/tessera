-- 1.4, U6: a goal with no finish line.
--
-- Not everything a person commits to has a number or a date. An ongoing goal is
-- a focus kept up over time: its tasks and hours still add up, and it is never
-- "achieved" and never late. `target` stays, untouched, so a goal can go back to
-- having a finish line without losing the number it had.

ALTER TABLE goal ADD COLUMN ongoing INTEGER NOT NULL DEFAULT 0 CHECK (ongoing IN (0, 1));
