-- ── Templates ─────────────────────────────────────────────────────────────
-- A set of tasks worth doing again, with the shape between them: titles,
-- estimates, milestones, dependencies by key, and dates as offsets from the
-- template's first date. Applying one makes new tasks; the template is the
-- plan for tasks, not tasks, so nothing here references `item`.
--
-- The body is JSON the database does not read. Its shape is the domain
-- layer's to enforce (`readBody`), the same way `view.config_json` is: a row
-- written by an older version reads as a template or as nothing, never as a
-- template with an edge to a task that is not there.

CREATE TABLE template (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    body_json  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_template_name ON template (name);
