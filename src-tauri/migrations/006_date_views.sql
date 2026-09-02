-- Tessera — migration 006: the views that answer "what now?".
--
-- These belong to no collection. That is what `collection_id IS NULL` means:
-- the same query engine with no collection filter, which is why Today needs no
-- second engine and no second store — it is a saved query like any other.
--
-- The dates are written as relative tokens rather than instants. A view called
-- Today has to mean today every day; an instant would freeze it on the day it
-- was saved. `src/domain/query.ts` resolves the token against the clock at read
-- time, which is what makes the promise keepable.

INSERT INTO view (id, collection_id, name, kind, config_json, position)
SELECT
    'view.today',
    NULL,
    'Today',
    'list',
    json('{
      "filters": [
        { "id": "due", "field": { "kind": "builtin", "field": "dueAt" },
          "operator": "lt", "value": "@todayEnd" }
      ],
      "match": "all",
      "sorts": [{ "field": { "kind": "builtin", "field": "dueAt" }, "direction": "asc" }],
      "groupBy": null,
      "includeCompleted": false
    }'),
    'c'
WHERE NOT EXISTS (SELECT 1 FROM view WHERE id = 'view.today');

INSERT INTO view (id, collection_id, name, kind, config_json, position)
SELECT
    'view.overdue',
    NULL,
    'Overdue',
    'list',
    json('{
      "filters": [
        { "id": "late", "field": { "kind": "builtin", "field": "dueAt" },
          "operator": "lt", "value": "@now" }
      ],
      "match": "all",
      "sorts": [{ "field": { "kind": "builtin", "field": "dueAt" }, "direction": "asc" }],
      "groupBy": null,
      "includeCompleted": false
    }'),
    'd'
WHERE NOT EXISTS (SELECT 1 FROM view WHERE id = 'view.overdue');

INSERT INTO view (id, collection_id, name, kind, config_json, position)
SELECT
    'view.next7',
    NULL,
    'Next 7 days',
    'list',
    json('{
      "filters": [
        { "id": "window", "field": { "kind": "builtin", "field": "dueAt" },
          "operator": "lt", "value": "@in7d" },
        { "id": "dated", "field": { "kind": "builtin", "field": "dueAt" },
          "operator": "is_not_empty", "value": null }
      ],
      "match": "all",
      "sorts": [{ "field": { "kind": "builtin", "field": "dueAt" }, "direction": "asc" }],
      "groupBy": null,
      "includeCompleted": false
    }'),
    'e'
WHERE NOT EXISTS (SELECT 1 FROM view WHERE id = 'view.next7');
