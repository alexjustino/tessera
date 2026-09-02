-- Tessera — migration 004: the views the default list starts with.
--
-- Two, because two is enough to make the point that a view is a saved query
-- over the same items rather than a different set of them: the same tasks, once
-- as a list and once as a table.
--
-- The stored query is the engine's shape, written here as the empty query. The
-- host does not interpret it; it is JSON that `src/domain/query.ts` reads.

INSERT INTO view (id, collection_id, name, kind, config_json, position)
SELECT
    'tasks.list',
    'tasks',
    'List',
    'list',
    json('{"filters":[],"match":"all","sorts":[],"groupBy":null,"includeCompleted":true}'),
    'V'
WHERE NOT EXISTS (SELECT 1 FROM view WHERE id = 'tasks.list');

INSERT INTO view (id, collection_id, name, kind, config_json, position)
SELECT
    'tasks.table',
    'tasks',
    'Table',
    'table',
    json('{"filters":[],"match":"all","sorts":[],"groupBy":null,"includeCompleted":true}'),
    'a'
WHERE NOT EXISTS (SELECT 1 FROM view WHERE id = 'tasks.table');
