-- Tessera — migration 005: the board.
--
-- A board is the query engine's grouping turned sideways: each group is a
-- column, and dropping a card into one is setting that field on that item. So
-- the seeded board is simply the same query as the list, grouped by status,
-- with the board's own settings alongside it.
--
-- `board` holds what only a board needs — work-in-progress limits, which
-- columns are collapsed, which properties appear on a card. It sits beside the
-- query rather than inside it, because none of it changes which items match.

INSERT INTO view (id, collection_id, name, kind, config_json, position)
SELECT
    'tasks.board',
    'tasks',
    'Board',
    'board',
    json('{
      "filters": [],
      "match": "all",
      "sorts": [],
      "groupBy": { "kind": "property", "propertyId": "tasks.status" },
      "includeCompleted": true,
      "board": {
        "wipLimits": {},
        "collapsed": [],
        "cardProperties": ["tasks.priority"]
      }
    }'),
    'b'
WHERE NOT EXISTS (SELECT 1 FROM view WHERE id = 'tasks.board');
