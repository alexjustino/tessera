-- 1.4, N2: a task and the notes about it.
--
-- A link written inside a document already says "this mentions that", and it is
-- derived from the text: delete the words and the link is gone. This says "these
-- two belong together", which a person decides from either side and which no
-- edit of the text should undo. Either side going removes the pair, and nothing else.

CREATE TABLE item_page (
    item_id TEXT NOT NULL REFERENCES item (id) ON DELETE CASCADE,
    page_id TEXT NOT NULL REFERENCES page (id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, page_id)
);

CREATE INDEX idx_item_page_page ON item_page (page_id);
