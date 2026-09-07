-- Tessera — migration 015: the notes space.
--
-- A page is a title and a document. The document is already possible: `block`
-- has taken `owner_kind = 'page'` since migration 001, because one editor was
-- always meant to serve items, events and pages. This adds the other half.
--
-- What makes it a wiki is `page_link`: an index of who points at whom, kept in
-- step by the same write that saves a document. It is derived data — every row
-- could be recomputed by reading every block — and it exists so that "what
-- points here" is a query rather than a scan of the whole workspace.

CREATE TABLE page (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,

    -- The title with case and spacing taken out, so two people writing the
    -- same name mean the same page. Unique: a wiki with two Weekly Reviews is
    -- a wiki where a link means nothing.
    title_key  TEXT NOT NULL,

    position   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_page_title_key ON page (title_key);
CREATE INDEX idx_page_position ON page (position);

-- One link, from a document to a page.
--
-- `to_page_id` is what the link points at, and it is nullable on purpose: a
-- link may name a page that does not exist yet, and a page may be deleted
-- while the documents that mentioned it stay exactly as they were written.
-- `to_title_key` is therefore always present — it is what such a link resolves
-- by, and what makes it point somewhere again the day that name comes back.
CREATE TABLE page_link (
    owner_kind   TEXT NOT NULL CHECK (owner_kind IN ('page', 'item', 'event')),
    owner_id     TEXT NOT NULL,
    to_page_id   TEXT REFERENCES page (id) ON DELETE SET NULL,
    to_title_key TEXT NOT NULL,
    to_title     TEXT NOT NULL,
    PRIMARY KEY (owner_kind, owner_id, to_title_key)
);

CREATE INDEX idx_page_link_target ON page_link (to_page_id);
CREATE INDEX idx_page_link_title ON page_link (to_title_key);
