-- Tessera — migration 002: the collection a new workspace starts with.
--
-- A workspace with no collection has nowhere to put a task, so the first run
-- would have to special-case an empty state that exists for exactly one moment.
-- Seeding it here instead means the invariant "there is always somewhere to
-- write" holds from the first query, and it holds for databases created before
-- this migration existed too — which is the whole point of forward-only
-- migrations.
--
-- `tasks` is a well-known identifier rather than a generated one, deliberately:
-- the application needs to be able to name this row without first looking it up.
--
-- The position is a valid fractional index key (ADR-006). It is written here as
-- a literal because SQL cannot call the ordering module, and 'V' is the middle
-- digit of the alphabet — the same key `firstKey()` produces.

INSERT INTO collection (id, name, icon, color, position, created_at, updated_at)
SELECT
    'tasks',
    'Tasks',
    'TaskListSquareLtr',
    NULL,
    'V',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM collection WHERE id = 'tasks');
