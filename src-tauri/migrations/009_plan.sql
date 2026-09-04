-- ── Planning ───────────────────────────────────────────────────────────────
-- What the critical path needs from an item: how long it takes, and whether it
-- takes any time at all.
--
-- `estimate_minutes` is not new. It has been in `item` since the first
-- migration and has never once been written — a column added on the guess that
-- it would be wanted. This is the release that wants it, so it becomes real
-- rather than being deleted the way `status_id` was.
--
-- `is_milestone` is a flag on the item rather than a property or an option,
-- because it is not a taxonomy a person defines: it changes how the item is
-- drawn and how it is scheduled. A milestone marks a moment — zero duration,
-- always, whatever estimate somebody typed before ticking the box.

ALTER TABLE item ADD COLUMN is_milestone INTEGER NOT NULL DEFAULT 0;

-- What is on the plan and what is a marker in it are asked together, on every
-- open of a view that draws either.
CREATE INDEX idx_item_milestone ON item (collection_id, is_milestone)
    WHERE archived_at IS NULL;
