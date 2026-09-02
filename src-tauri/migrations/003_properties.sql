-- Tessera — migration 003: the typed fields a collection declares.
--
-- Two things happen here, and the first is a retraction.
--
-- `item.status_id` was added in migration 001 on the assumption that status
-- would be special. It turns out not to be: status is a property like any
-- other, which is what lets the board group by *any* select property rather
-- than by one privileged column. The column was never written to, so it goes
-- now rather than sitting in the schema as a permanent question.
--
-- Removing a column we guessed at is cheaper today than explaining it in a
-- year. Forward-only means the retraction is itself a migration, applied to
-- every existing database exactly once.

ALTER TABLE item DROP COLUMN status_id;

-- The two properties the default list starts with.
--
-- `is_system` marks them as seeded: they can be renamed and their options
-- edited, but not deleted, because views and the board refer to them by key.
--
-- Identifiers are well-known rather than generated, for the same reason the
-- default collection's is: the application needs to name them without first
-- looking them up.

INSERT INTO property (id, collection_id, key, name, type, config_json, position, is_system)
SELECT
    'tasks.status',
    'tasks',
    'status',
    'Status',
    'status',
    json('{"options":[
            {"id":"todo","label":"To do","color":null,"group":"todo"},
            {"id":"doing","label":"In progress","color":"info","group":"doing"},
            {"id":"blocked","label":"Blocked","color":"danger","group":"doing"},
            {"id":"done","label":"Done","color":"success","group":"done"}
          ]}'),
    'V',
    1
WHERE NOT EXISTS (SELECT 1 FROM property WHERE id = 'tasks.status');

INSERT INTO property (id, collection_id, key, name, type, config_json, position, is_system)
SELECT
    'tasks.priority',
    'tasks',
    'priority',
    'Priority',
    'priority',
    -- The priority scale is fixed in the domain layer, not configurable here:
    -- priority means the same thing across every collection so that a
    -- cross-collection view can sort by it.
    json('{}'),
    'a',
    1
WHERE NOT EXISTS (SELECT 1 FROM property WHERE id = 'tasks.priority');
