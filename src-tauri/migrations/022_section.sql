-- 1.4, the fourth look: a notebook in sections, as OneNote keeps one.
--
-- A section is a named, coloured group of pages. A page belongs to one section or to
-- none, and a page in none is in Quick notes, which is not a row: it is where pages
-- that were never filed, and pages whose section was deleted, are. Deleting a section
-- never deletes a page; its pages go back to Quick notes.

CREATE TABLE section (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT,
    position   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

ALTER TABLE page ADD COLUMN section_id TEXT REFERENCES section (id) ON DELETE SET NULL;

CREATE INDEX idx_page_section ON page (section_id);
