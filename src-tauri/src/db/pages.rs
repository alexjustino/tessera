//! Pages — the notes space, and the index of what points at what.
//!
//! A page is a title and a document; the document is `block` rows with
//! `owner_kind = 'page'`, written by the same editor everything else uses.
//! Two things live here that do not live anywhere else.
//!
//! **A name is unique.** Not as a nicety — as the thing that makes a link
//! written by hand mean one page. The uniqueness is a unique index on the
//! normalised title, so two windows racing to create "Weekly Review" cannot
//! both win.
//!
//! **`page_link` is derived and rewritten whole.** Every save of a document
//! replaces that owner's links with the ones the document now has, in the same
//! transaction as the blocks. Reconciling them one by one would be more code
//! and would leave a link behind the day a paragraph was deleted.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::items::now;
use crate::error::{Error, Result};

/// The longest a title may be, matching the domain's own limit.
const MAX_TITLE: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Page {
    pub id: String,
    pub title: String,
    pub position: String,
    pub created_at: String,
    pub updated_at: String,
}

/// One link, as a document says it: an id when it has one, and the name.
#[derive(Debug, Clone, Deserialize)]
pub struct LinkTarget {
    pub page_id: Option<String>,
    pub title: String,
}

/// A document that points here.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Backlink {
    pub owner_kind: String,
    pub owner_id: String,
    /// What that document is called — a page's title, a task's or event's.
    pub title: String,
}

fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Page> {
    Ok(Page {
        id: row.get(0)?,
        title: row.get(1)?,
        position: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

/// A title with case and spacing taken out — the same rule as the domain's.
///
/// Kept here as well as there because it decides what the database considers
/// one page: a client that skipped the normalisation could otherwise create a
/// second Weekly Review, and the index would let it.
pub fn title_key(title: &str) -> String {
    title
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn check_title(title: &str) -> Result<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(Error::InvalidInput("a page needs a name"));
    }
    if trimmed.chars().count() > MAX_TITLE {
        return Err(Error::InvalidInput("that name is too long for a page"));
    }
    Ok(trimmed.to_string())
}

/// Every page, in the order they were put in.
pub fn list(conn: &Connection) -> Result<Vec<Page>> {
    let mut statement = conn.prepare(
        "SELECT id, title, position, created_at, updated_at FROM page ORDER BY position, created_at",
    )?;
    let rows = statement.query_map([], read)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Page> {
    conn.query_row(
        "SELECT id, title, position, created_at, updated_at FROM page WHERE id = ?1",
        params![id],
        read,
    )
    .optional()?
    .ok_or(Error::NotFound)
}

/// Make a page.
///
/// Creating it resolves the links that were already written for that name:
/// somebody typed `[[Retrospective]]` last week, and the page they meant now
/// exists, so the rows that were waiting on the name point at it.
pub fn create(conn: &mut Connection, title: &str, position: &str) -> Result<Page> {
    let title = check_title(title)?;
    let key = title_key(&title);
    let timestamp = now();
    let id = Uuid::now_v7().to_string();

    let transaction = conn.transaction()?;
    let taken: bool = transaction
        .query_row(
            "SELECT 1 FROM page WHERE title_key = ?1",
            params![key],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if taken {
        return Err(Error::InvalidInput(
            "there is already a page with that name",
        ));
    }

    transaction.execute(
        "INSERT INTO page (id, title, title_key, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, title, key, position, timestamp],
    )?;
    transaction.execute(
        "INSERT INTO search_fts (owner_kind, owner_id, title, body) VALUES ('page', ?1, ?2, '')",
        params![id, title],
    )?;
    // Links that named this page before it existed now have somewhere to go.
    transaction.execute(
        "UPDATE page_link SET to_page_id = ?1 WHERE to_page_id IS NULL AND to_title_key = ?2",
        params![id, key],
    )?;
    transaction.commit()?;

    get(conn, &id)
}

/// Rename a page.
///
/// Nothing else moves. Every link to it points at the id, so the links are
/// untouched by construction — which is the whole reason they point at the id
/// (ADR-029). The search index follows, because the title is indexed there.
pub fn rename(conn: &mut Connection, id: &str, title: &str) -> Result<Page> {
    let title = check_title(title)?;
    let key = title_key(&title);
    let timestamp = now();

    let transaction = conn.transaction()?;
    let taken: bool = transaction
        .query_row(
            "SELECT 1 FROM page WHERE title_key = ?1 AND id <> ?2",
            params![key, id],
            |_| Ok(true),
        )
        .optional()?
        .unwrap_or(false);
    if taken {
        return Err(Error::InvalidInput(
            "there is already a page with that name",
        ));
    }

    let changed = transaction.execute(
        "UPDATE page SET title = ?2, title_key = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, title, key, timestamp],
    )?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    transaction.execute(
        "UPDATE search_fts SET title = ?2 WHERE owner_kind = 'page' AND owner_id = ?1",
        params![id, title],
    )?;
    // A link that was waiting for this name — written before the page was, or
    // after another page gave the name up — now has it.
    transaction.execute(
        "UPDATE page_link SET to_page_id = ?1 WHERE to_page_id IS NULL AND to_title_key = ?2",
        params![id, key],
    )?;
    transaction.commit()?;

    get(conn, id)
}

/// Delete a page, its document, its own links, and its place in the index.
///
/// Links **to** it are not deleted: `page_link.to_page_id` is set to null by
/// the schema, so a document that mentioned this page still says so, and still
/// says which name it used. Deleting those rows would make the mention vanish
/// from the one place a person would look for it.
pub fn delete(conn: &mut Connection, id: &str) -> Result<()> {
    let transaction = conn.transaction()?;
    let changed = transaction.execute("DELETE FROM page WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(Error::NotFound);
    }
    transaction.execute(
        "DELETE FROM block WHERE owner_kind = 'page' AND owner_id = ?1",
        params![id],
    )?;
    transaction.execute(
        "DELETE FROM page_link WHERE owner_kind = 'page' AND owner_id = ?1",
        params![id],
    )?;
    transaction.execute(
        "DELETE FROM search_fts WHERE owner_kind = 'page' AND owner_id = ?1",
        params![id],
    )?;
    transaction.commit()?;
    Ok(())
}

/// Replace what one document points at.
///
/// Called from the same transaction that saves the document, so the index can
/// never describe links a document does not have. Rewritten whole rather than
/// reconciled: the set is small, and a leftover row is a backlink to a
/// paragraph somebody deleted.
pub fn set_links(
    transaction: &rusqlite::Transaction<'_>,
    owner_kind: &str,
    owner_id: &str,
    links: &[LinkTarget],
) -> Result<()> {
    transaction.execute(
        "DELETE FROM page_link WHERE owner_kind = ?1 AND owner_id = ?2",
        params![owner_kind, owner_id],
    )?;

    for link in links {
        let key = title_key(&link.title);
        // A link with an id and no name still has a name: the page's own.
        let (page_id, key, title) = match link.page_id.as_deref() {
            Some(page_id) => {
                let found: Option<(String, String)> = transaction
                    .query_row(
                        "SELECT title_key, title FROM page WHERE id = ?1",
                        params![page_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()?;
                match found {
                    // The page is gone: keep the mention, by the name it used.
                    None if key.is_empty() => continue,
                    None => (None, key, link.title.trim().to_string()),
                    Some((stored_key, stored_title)) => {
                        (Some(page_id.to_string()), stored_key, stored_title)
                    }
                }
            }
            None => {
                if key.is_empty() {
                    continue;
                }
                let existing: Option<String> = transaction
                    .query_row(
                        "SELECT id FROM page WHERE title_key = ?1",
                        params![key],
                        |row| row.get(0),
                    )
                    .optional()?;
                (existing, key, link.title.trim().to_string())
            }
        };

        // A document that names the same page twice is one link, and the
        // primary key says so; the second insert is not an error.
        transaction.execute(
            "INSERT OR REPLACE INTO page_link (owner_kind, owner_id, to_page_id, to_title_key, to_title)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![owner_kind, owner_id, page_id, key, title],
        )?;
    }
    Ok(())
}

/// What points at this page — by id, and by the name it has.
///
/// The second half is what makes a deleted-and-remade page keep its incoming
/// mentions: those rows never had an id, and they find their way home by name.
pub fn backlinks(conn: &Connection, id: &str) -> Result<Vec<Backlink>> {
    let key: String = conn
        .query_row(
            "SELECT title_key FROM page WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(Error::NotFound)?;

    let mut statement = conn.prepare(
        "SELECT l.owner_kind, l.owner_id,
                COALESCE(p.title, i.title, e.title, '')
         FROM page_link l
         LEFT JOIN page  p ON l.owner_kind = 'page'  AND p.id = l.owner_id
         LEFT JOIN item  i ON l.owner_kind = 'item'  AND i.id = l.owner_id AND i.archived_at IS NULL
         LEFT JOIN event e ON l.owner_kind = 'event' AND e.id = l.owner_id
         WHERE (l.to_page_id = ?1 OR (l.to_page_id IS NULL AND l.to_title_key = ?2))
           AND l.owner_id <> ?1
           AND (p.id IS NOT NULL OR i.id IS NOT NULL OR e.id IS NOT NULL)
         ORDER BY 3 COLLATE NOCASE",
    )?;
    let rows = statement.query_map(params![id, key], |row| {
        Ok(Backlink {
            owner_kind: row.get(0)?,
            owner_id: row.get(1)?,
            title: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::blocks;
    use crate::db::migrations;
    use crate::db::models::{BlockChanges, BlockCreate};

    fn workspace() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrations::apply(&conn).unwrap();
        let _ = &mut conn;
        conn
    }

    fn link_to(id: Option<&str>, title: &str) -> LinkTarget {
        LinkTarget {
            page_id: id.map(str::to_string),
            title: title.to_string(),
        }
    }

    fn write_links(conn: &mut Connection, owner_id: &str, links: &[LinkTarget]) {
        let transaction = conn.transaction().unwrap();
        set_links(&transaction, "page", owner_id, links).unwrap();
        transaction.commit().unwrap();
    }

    #[test]
    fn a_name_is_one_page_however_it_is_typed() {
        let mut conn = workspace();
        create(&mut conn, "Weekly Review", "m").unwrap();
        assert!(create(&mut conn, "  weekly   review  ", "n").is_err());
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn a_page_needs_a_name_that_is_not_only_space() {
        let mut conn = workspace();
        assert!(create(&mut conn, "   ", "m").is_err());
        assert!(create(&mut conn, &"x".repeat(201), "m").is_err());
    }

    #[test]
    fn renaming_keeps_every_link_that_points_at_the_page() {
        let mut conn = workspace();
        let target = create(&mut conn, "Weekly Review", "m").unwrap();
        let source = create(&mut conn, "Onboarding", "n").unwrap();
        write_links(
            &mut conn,
            &source.id,
            &[link_to(Some(&target.id), "Weekly Review")],
        );

        let renamed = rename(&mut conn, &target.id, "Monday Review").unwrap();
        assert_eq!(renamed.title, "Monday Review");

        let found = backlinks(&conn, &target.id).unwrap();
        assert_eq!(
            found,
            vec![Backlink {
                owner_kind: "page".into(),
                owner_id: source.id.clone(),
                title: "Onboarding".into(),
            }]
        );
    }

    #[test]
    fn a_link_written_before_the_page_finds_it_when_it_is_made() {
        let mut conn = workspace();
        let source = create(&mut conn, "Onboarding", "m").unwrap();
        write_links(&mut conn, &source.id, &[link_to(None, "Retrospective")]);

        let made = create(&mut conn, "retrospective", "n").unwrap();
        let row: Option<String> = conn
            .query_row(
                "SELECT to_page_id FROM page_link WHERE owner_id = ?1",
                params![source.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(row, Some(made.id.clone()));
        assert_eq!(backlinks(&conn, &made.id).unwrap().len(), 1);
    }

    #[test]
    fn a_name_that_is_freed_by_a_rename_is_picked_up_by_the_page_that_takes_it() {
        let mut conn = workspace();
        let source = create(&mut conn, "Onboarding", "m").unwrap();
        write_links(&mut conn, &source.id, &[link_to(None, "Handbook")]);
        let other = create(&mut conn, "Manual", "n").unwrap();

        rename(&mut conn, &other.id, "Handbook").unwrap();
        assert_eq!(backlinks(&conn, &other.id).unwrap().len(), 1);
    }

    #[test]
    fn deleting_a_page_keeps_the_mentions_of_it_and_they_come_back() {
        let mut conn = workspace();
        let target = create(&mut conn, "Weekly Review", "m").unwrap();
        let source = create(&mut conn, "Onboarding", "n").unwrap();
        write_links(
            &mut conn,
            &source.id,
            &[link_to(Some(&target.id), "Weekly Review")],
        );

        delete(&mut conn, &target.id).unwrap();
        let row: (Option<String>, String) = conn
            .query_row(
                "SELECT to_page_id, to_title FROM page_link WHERE owner_id = ?1",
                params![source.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, (None, "Weekly Review".to_string()));

        // Made again under the same name, the mention points at it once more.
        let again = create(&mut conn, "Weekly Review", "o").unwrap();
        assert_eq!(backlinks(&conn, &again.id).unwrap().len(), 1);
    }

    #[test]
    fn a_page_does_not_count_as_pointing_at_itself() {
        let mut conn = workspace();
        let page = create(&mut conn, "Weekly Review", "m").unwrap();
        write_links(
            &mut conn,
            &page.id,
            &[link_to(Some(&page.id), "Weekly Review")],
        );
        assert_eq!(backlinks(&conn, &page.id).unwrap(), vec![]);
    }

    #[test]
    fn saving_a_document_replaces_the_links_it_had() {
        let mut conn = workspace();
        let a = create(&mut conn, "A", "m").unwrap();
        let b = create(&mut conn, "B", "n").unwrap();
        let source = create(&mut conn, "Source", "o").unwrap();

        write_links(&mut conn, &source.id, &[link_to(Some(&a.id), "A")]);
        assert_eq!(backlinks(&conn, &a.id).unwrap().len(), 1);

        write_links(&mut conn, &source.id, &[link_to(Some(&b.id), "B")]);
        assert_eq!(backlinks(&conn, &a.id).unwrap(), vec![]);
        assert_eq!(backlinks(&conn, &b.id).unwrap().len(), 1);
    }

    #[test]
    fn a_document_that_names_the_same_page_twice_is_one_backlink() {
        let mut conn = workspace();
        let target = create(&mut conn, "Weekly Review", "m").unwrap();
        let source = create(&mut conn, "Onboarding", "n").unwrap();
        write_links(
            &mut conn,
            &source.id,
            &[
                link_to(Some(&target.id), "Weekly Review"),
                link_to(None, "weekly review"),
            ],
        );
        assert_eq!(backlinks(&conn, &target.id).unwrap().len(), 1);
    }

    #[test]
    fn the_document_of_a_page_goes_with_it() {
        let mut conn = workspace();
        let page = create(&mut conn, "Weekly Review", "m").unwrap();
        blocks::apply_changes(
            &mut conn,
            "page",
            &page.id,
            BlockChanges {
                creates: vec![BlockCreate {
                    id: "b1".into(),
                    r#type: "paragraph".into(),
                    position: "m".into(),
                    content: serde_json::json!({ "type": "paragraph" }),
                }],
                updates: vec![],
                deletes: vec![],
            },
            "the rescission clause",
            &[],
        )
        .unwrap();

        let found: i64 = conn
            .query_row(
                "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'rescission'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(found, 1);

        delete(&mut conn, &page.id).unwrap();
        for (table, sql) in [
            ("block", "SELECT count(*) FROM block WHERE owner_id = ?1"),
            (
                "search_fts",
                "SELECT count(*) FROM search_fts WHERE owner_id = ?1",
            ),
        ] {
            let left: i64 = conn.query_row(sql, params![page.id], |r| r.get(0)).unwrap();
            assert_eq!(left, 0, "{table} still holds rows for a deleted page");
        }
    }
}
