-- 1.4, the third look: notes started from a meeting.
--
-- One page for one occurrence of an event. A weekly meeting has a page for each
-- week, so the pair names the occurrence by the start the series gave it
-- (`original_start`, the same key an exception uses), not by where it was moved.
-- Like `item_page` (ADR-041), it is a pair a person made: either side going
-- removes it, and nothing else.

CREATE TABLE event_page (
    event_id       TEXT NOT NULL REFERENCES event (id) ON DELETE CASCADE,
    original_start TEXT NOT NULL,
    page_id        TEXT NOT NULL REFERENCES page (id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, original_start)
);

CREATE INDEX idx_event_page_page ON event_page (page_id);
